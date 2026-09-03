// ────────────────────────────────────────────────────────────────
// VoiceService — Voice Module (STT + TTS) lifecycle + event emission.
//
// Third instance of the BrowserService/TerminalService pattern — see
// docs/VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part A.2 / Part B.3: a
// session-scoped, native-model-backed capability service, behind a port,
// capacity-capped, cleaned up on idle.
//
// One deliberate divergence from that precedent, called out explicitly:
// Browser/Terminal sessions are workspace-scoped resources (one Chromium /
// PTY tied to a workspace's lifetime, cleaned up via
// `WorkspaceManager.registerBeforeDelete`). An STT dictation session is NOT
// workspace-scoped — the chat composer's mic button works even for chats
// with no attached project (a Chat's ExecutionWorkspace is optional per
// AGENTS.md's domain model), and today's `/api/stt/stream` ticket carries no
// workspace id at all. So sessions here are keyed by a server-generated
// `sessionId` (like Terminal's per-PTY `sid`, not Browser's per-workspace
// singleton), `workspaceId` is nullable and carried for observability only,
// and there is no `registerBeforeDelete` hook — nothing to orphan, since
// each session already lives and dies with its own WebSocket connection
// (`ws.on('close')` already cancels it, same as before this service
// existed).
//
// Emits `voice.*` lifecycle events on the unified EventBus, scoped
// `voice:<sessionId>` (not workspace-scoped, per the note above) so nothing
// currently subscribes but the observability shape matches every other
// capability service in this codebase.
//
// Consumed by:
//   • apps/server/src/stt-ws.ts   (STT transport)
//   • apps/server/src/composition-root.ts (wiring)
//
// Phase 0 (this file, initial version): STT half only, ports the existing
// SttSession/WhisperSttEngine behavior behind this Map-based lifecycle with
// zero behavior change. Phase 1 adds pause()/resume(). Phase 2 adds an
// optional `ITextFormatter` cleanup pass, threaded into every
// `SttSessionRunner` this service creates. Phase 3 adds speak()/TTS — a
// small `speechSessions` Map (not idle-reaped like the STT half, since a
// speak() call is inherently bounded and self-terminating: the audio
// generator ends when synthesis completes, errors, or `stop()` is called
// AND then driven at least once more — see `releaseSpeech()`'s comment for
// why the "AND then driven" clause matters). The Map exists purely so
// `shutdown()` can reach in-flight sessions it otherwise has no handle on,
// and so `stop()`-without-ever-consuming can't leak a concurrency-cap slot
// forever; there's still no "listening forever" state to reap the way an
// open STT session has. Phase 4 (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md
// Part E) is additive: `speak()`'s `text` parameter already accepts a live
// `AsyncIterable<string>` (the agent's own token stream, sentence-boundary
// buffered — see TtsSessionRunner.ts/SentenceBoundaryBuffer.ts), not just
// a finished string, so nothing about this method's signature needed to
// change to support it.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { readBoundedInt } from '@generatorai/shared';
import type { ILogger, AgentEvent, SttEngineKind, SttSessionStatus, SttSessionDescriptor } from '@generatorai/shared';
import type { EventBus } from '../events/EventBus.js';
import type { ISpeechToTextEngine } from '../domain/ports/ISpeechToTextEngine.js';
import type { ITextToSpeechEngine } from '../domain/ports/ITextToSpeechEngine.js';
import type { ITextFormatter } from '../domain/ports/ITextFormatter.js';
import { SttSessionRunner, type SttSessionCallbacks } from '../infrastructure/voice/SttSessionRunner.js';
import type { VoiceActivityDetector } from '../infrastructure/voice/VoiceActivityDetector.js';
import { TtsSessionRunner, type TtsRunOptions } from '../infrastructure/voice/TtsSessionRunner.js';

/** Config knobs — envs override at composition-root wiring time. */
export interface VoiceServiceConfig {
  /** Global concurrent-STT-session cap. Default 20. */
  maxConcurrent?: number;
  /** Idle TTL — session with no audio/control activity for this long is force-cancelled. Default 5 min. */
  idleTtlMs?: number;
  /** Idle reaper tick period. Default 60 s. */
  idleReaperMs?: number;
  /** Synthetic EventBus session id prefix. Emitted events land on `${prefix}:${sessionId}`. */
  eventBusScopePrefix?: string;
  /** Phase 3 — global concurrent-speak()-session cap. Default 10. */
  maxConcurrentSpeech?: number;
  /**
   * How long `start()` waits before eagerly warming the engines. Keeps
   * model loading out of the server's own startup burst — see `start()`.
   * Default 5 s. Set to 0 in tests that assert warm-up behaviour.
   */
  warmupDelayMs?: number;
}

/**
 * Phase 3/4 speak options. Extends the engine's own synthesis options with
 * the sentence-boundary hook the TTS transport uses — see TtsRunOptions.
 */
export type SpeakOptions = TtsRunOptions;

/** Handle returned to a `speak()` caller. */
export interface SpeechSessionHandle {
  readonly sessionId: string;
  /** Raw Float32 PCM chunks at the configured TTS engine's `sampleRate`, in speech order. */
  readonly audio: AsyncIterable<Float32Array>;
  /** Barge-in (Part C.3-equivalent for speech, Part E Phase 4) — stop synthesizing/yielding further audio. */
  stop(): void;
}

/** Handle returned to the WS transport layer for one active STT session. */
export interface SttSessionHandle {
  readonly sessionId: string;
  start(language?: string, options?: { interim?: boolean }): void;
  pushAudio(pcm: Float32Array): void;
  /** Phase 1 — suspend audio consumption without tearing the engine down (Part C.3). */
  pause(): void;
  /** Phase 1 — continue the SAME session; no reload, no re-negotiation. */
  resume(): void;
  stop(): Promise<void>;
  cancel(): void;
}

interface VoiceSessionRecord {
  id: string;
  workspaceId: string | null;
  runner: SttSessionRunner;
  engineKind: SttEngineKind;
  status: SttSessionStatus;
  createdAt: number;
  lastActivityAt: number;
}

/**
 * Tracked for the lifetime of one `speak()` call — see `releaseSpeech()`.
 * Unlike `VoiceSessionRecord` this isn't reaped on an idle timer: a speech
 * session is bounded by definition (it ends when synthesis completes,
 * errors, or `stop()` is called), so the only jobs this record exists for
 * are (a) letting `shutdown()` reach in-flight sessions it otherwise has no
 * handle on, and (b) letting `releaseSpeech()` be called from two different
 * places (the generator's `finally` AND `stop()`) without double-releasing
 * the concurrency-cap slot.
 */
interface SpeechSessionRecord {
  id: string;
  workspaceId: string | null;
  runner: TtsSessionRunner;
  released: boolean;
}

export class VoiceService {
  private sessions = new Map<string, VoiceSessionRecord>();
  private speechSessions = new Map<string, SpeechSessionRecord>();
  private readonly cfg: Required<VoiceServiceConfig>;
  private idleTimer: NodeJS.Timeout | null = null;
  private activeSpeechCount = 0;

  constructor(
    private readonly sttEngine: ISpeechToTextEngine,
    private readonly eventBus: EventBus,
    private readonly logger: ILogger,
    config?: VoiceServiceConfig,
    /** Phase 2 — optional cleanup pass applied to every segment/final transcript. */
    private readonly textFormatter?: ITextFormatter,
    /** Phase 3 — optional; `speak()` throws if this isn't configured. */
    private readonly ttsEngine?: ITextToSpeechEngine,
    /**
     * Builds the segmentation detector for each new session. A detector holds
     * per-utterance state (and, for the neural one, per-stream model state),
     * so every session needs its OWN — hence a factory rather than an
     * instance. Omitted, `SttSessionRunner` falls back to its RMS default.
     */
    private readonly createVad?: () => VoiceActivityDetector,
  ) {
    // Bounded reads: a bare `Number()` turns a typo into `NaN`, which removes
    // a cap silently (every `>=` becomes false) and turns an interval into a
    // 1 ms busy loop (Node coerces NaN that way).
    this.cfg = {
      maxConcurrent:
        config?.maxConcurrent ??
        readBoundedInt('GENERATORAI_VOICE_MAX_CONCURRENT', { defaultValue: 20, min: 1, max: 500 }),
      idleTtlMs:
        config?.idleTtlMs ??
        readBoundedInt('GENERATORAI_VOICE_IDLE_TTL_MS', {
          defaultValue: 5 * 60 * 1000,
          min: 10_000,
          max: 24 * 60 * 60 * 1000,
        }),
      idleReaperMs:
        config?.idleReaperMs ??
        readBoundedInt('GENERATORAI_VOICE_IDLE_REAPER_MS', {
          defaultValue: 60_000,
          min: 1_000,
          max: 60 * 60 * 1000,
        }),
      eventBusScopePrefix: config?.eventBusScopePrefix ?? 'voice',
      maxConcurrentSpeech:
        config?.maxConcurrentSpeech ??
        readBoundedInt('GENERATORAI_VOICE_MAX_CONCURRENT_SPEECH', {
          defaultValue: 10,
          min: 1,
          max: 200,
        }),
      warmupDelayMs:
        config?.warmupDelayMs ??
        readBoundedInt('GENERATORAI_VOICE_WARMUP_DELAY_MS', {
          defaultValue: 5_000,
          min: 0,
          max: 5 * 60 * 1000,
        }),
    };
  }

  /**
   * Boot the idle reaper and eagerly warm the engine. Idempotent.
   *
   * The eager `load()` is a telemetry-accuracy fix, not a functional
   * requirement: `sttEngineKindOf()` (used by `describe()` and the
   * `voice.stt_session_started` event) reads `this.sttEngine.name`
   * synchronously, and `CascadingSttEngine.name` only reports which
   * candidate actually won AFTER its first `load()` resolves — before
   * that it reports the combined `cascading:parakeet:...|whisper:...`
   * form, which still classifies as 'parakeet' (substring match). Kicking
   * load() off here means that resolution has almost always already
   * happened by the time any real user clicks the mic, instead of only
   * resolving lazily on the first session's own `start()` call.
   *
   * It is DEFERRED rather than immediate. Even with inference on a worker
   * thread (see VoiceWorkerPool.ts), building the ONNX sessions saturates
   * the machine for several seconds, and `start()` is called in the middle
   * of the composition root's own startup burst — DB recovery, retention
   * sweep, extension loading, harness init, all synchronous on the main
   * thread. Measured: with voice enabled the two together pushed the main
   * loop past `WedgeDetector`'s 5s threshold during startup and tripped a
   * (correct) wedge alert; with `GENERATORAI_STT=0 GENERATORAI_TTS=0` the
   * same startup produced none. Waiting a few seconds costs nothing — the
   * warm-up exists to be ready before the first *user* interaction, which
   * is never within seconds of boot — and keeps the two off each other.
   */
  start(): void {
    const warmupTimer = setTimeout(() => {
      void this.sttEngine.load().catch((err) => {
        this.logger.warn?.(`[VoiceService] eager STT engine warm-up failed: ${(err as Error).message}`);
      });
      // Same rationale, other direction: without this the first "Read aloud"
      // click anywhere on the server pays Kokoro's full model-load latency
      // inline instead of it having already happened in the background.
      void this.ttsEngine?.load().catch((err) => {
        this.logger.warn?.(`[VoiceService] eager TTS engine warm-up failed: ${(err as Error).message}`);
      });
    }, this.cfg.warmupDelayMs);
    // Must not hold the process open on its own — a short-lived CLI run that
    // never touches voice should still exit promptly.
    warmupTimer.unref?.();

    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => this.reapIdle(), this.cfg.idleReaperMs);
    // Node's unref lets the process exit even when the timer is pending.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.idleTimer as any).unref?.();
  }

  /** Cancel everything + stop the reaper + dispose the engine. Called from container.shutdown. */
  async shutdown(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    for (const rec of this.sessions.values()) {
      rec.runner.cancel();
    }
    this.sessions.clear();
    // Barge-in every in-flight speak() session before disposing the engine.
    // Without this, a session some caller is still actively draining (e.g.
    // tts-ws.ts's not-explicitly-awaited consume loop) would keep pulling
    // audio chunks — and therefore keep the underlying engine busy — for as
    // long as the caller kept iterating, with nothing here ever telling it
    // to stop. `releaseSpeech()` is idempotent, so it's safe to call this
    // even for a session whose own `finally` block also releases it later.
    for (const rec of this.speechSessions.values()) {
      rec.runner.stop();
      this.releaseSpeech(rec);
    }
    await this.sttEngine.dispose().catch(() => undefined);
    await this.ttsEngine?.dispose().catch(() => undefined);
  }

  // ── STT half ──────────────────────────────────────────────────

  /**
   * Open a new STT session. `workspaceId` is nullable and carried only for
   * observability — see file header. Throws if the global cap is reached.
   */
  startSttSession(workspaceId: string | null, cb: SttSessionCallbacks): SttSessionHandle {
    if (this.sessions.size >= this.cfg.maxConcurrent) {
      throw new Error(`Voice STT session refused — server cap (${this.cfg.maxConcurrent}) reached`);
    }
    const id = randomUUID();
    const runner = new SttSessionRunner(
      this.sttEngine,
      cb,
      this.logger,
      undefined,
      this.textFormatter,
      this.createVad?.(),
    );
    const rec: VoiceSessionRecord = {
      id,
      workspaceId,
      runner,
      engineKind: sttEngineKindOf(this.sttEngine),
      status: 'listening',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.sessions.set(id, rec);
    void this.emit(id, { kind: 'voice.stt_session_started', data: { workspaceId, sessionId: id, engine: rec.engineKind } });

    return {
      sessionId: id,
      start: (language, options) => {
        rec.lastActivityAt = Date.now();
        runner.start(language, options);
      },
      pushAudio: (pcm) => {
        rec.lastActivityAt = Date.now();
        runner.pushAudio(pcm);
      },
      pause: () => {
        rec.status = 'paused';
        rec.lastActivityAt = Date.now();
        runner.pause();
        void this.emit(id, { kind: 'voice.stt_paused', data: { workspaceId, sessionId: id } });
      },
      resume: () => {
        rec.status = 'listening';
        rec.lastActivityAt = Date.now();
        runner.resume();
        void this.emit(id, { kind: 'voice.stt_resumed', data: { workspaceId, sessionId: id } });
      },
      stop: async () => {
        rec.status = 'finalizing';
        rec.lastActivityAt = Date.now();
        await runner.stop();
        this.endSession(id, 'stopped');
      },
      cancel: () => {
        runner.cancel();
        this.endSession(id, 'cancelled');
      },
    };
  }

  /** Look up a session's descriptor (debug/telemetry). */
  describe(sessionId: string): SttSessionDescriptor | null {
    const rec = this.sessions.get(sessionId);
    if (!rec) return null;
    return {
      id: rec.id,
      workspaceId: rec.workspaceId,
      engine: rec.engineKind,
      status: rec.status,
      createdAt: rec.createdAt,
      lastActivityAt: rec.lastActivityAt,
    };
  }

  // ── TTS half (Phase 3) ───────────────────────────────────────────

  /**
   * The configured TTS engine's sample rate (Hz), or `null` if none is
   * configured. Lets a WS transport tell the client how to interpret the
   * raw PCM frames it's about to receive without the client needing to
   * hardcode a value tied to whichever engine happens to be wired in.
   */
  get ttsSampleRate(): number | null {
    return this.ttsEngine?.sampleRate ?? null;
  }

  /**
   * Synthesize `text` (a finished string — Phase 3's "read this message
   * aloud" — or a live `AsyncIterable<string>` — Phase 4's speak-while-
   * streaming) and return a handle whose `audio` yields raw PCM chunks in
   * speech order. Throws synchronously if no TTS engine is configured or
   * the concurrency cap is reached — callers (the WS transport) must
   * guard this the same way `startSttSession()`'s equivalent throw is
   * guarded in stt-ws.ts.
   */
  speak(workspaceId: string | null, text: string | AsyncIterable<string>, opts?: SpeakOptions): SpeechSessionHandle {
    if (!this.ttsEngine) {
      throw new Error('Voice TTS is not configured on this server (no ITextToSpeechEngine wired into VoiceService)');
    }
    if (this.activeSpeechCount >= this.cfg.maxConcurrentSpeech) {
      throw new Error(`Voice TTS session refused — server cap (${this.cfg.maxConcurrentSpeech}) reached`);
    }
    const id = randomUUID();
    const runner = new TtsSessionRunner(this.ttsEngine, this.logger);
    const rec: SpeechSessionRecord = { id, workspaceId, runner, released: false };
    this.speechSessions.set(id, rec);
    this.activeSpeechCount += 1;
    void this.emit(id, { kind: 'voice.tts_session_started', data: { workspaceId, sessionId: id } });

    return {
      sessionId: id,
      audio: this.runSpeak(rec, text, opts),
      stop: () => {
        runner.stop();
        // `runSpeak`'s `finally` only runs once the generator it wraps is
        // actually driven (a generator's body — including `finally` — does
        // not execute at all until something calls `.next()`/`.return()` on
        // it). A caller that calls `stop()` and never touches `handle.audio`
        // would otherwise hold this concurrency-cap slot forever.
        // `releaseSpeech()` is idempotent, so this is safe even for a caller
        // that also fully drains `audio` afterwards.
        this.releaseSpeech(rec);
      },
    };
  }

  private async *runSpeak(
    rec: SpeechSessionRecord,
    text: string | AsyncIterable<string>,
    opts?: SpeakOptions,
  ): AsyncGenerator<Float32Array> {
    try {
      yield* rec.runner.run(text, opts);
    } finally {
      this.releaseSpeech(rec);
    }
  }

  /** Release a speak() session's concurrency-cap slot exactly once. */
  private releaseSpeech(rec: SpeechSessionRecord): void {
    if (rec.released) return;
    rec.released = true;
    this.speechSessions.delete(rec.id);
    this.activeSpeechCount = Math.max(0, this.activeSpeechCount - 1);
    void this.emit(rec.id, { kind: 'voice.tts_session_ended', data: { workspaceId: rec.workspaceId, sessionId: rec.id } });
  }

  // ── Internal ──────────────────────────────────────────────────

  private endSession(sessionId: string, reason: string): void {
    const rec = this.sessions.get(sessionId);
    if (!rec) return;
    this.sessions.delete(sessionId);
    void this.emit(sessionId, {
      kind: 'voice.stt_session_ended',
      data: { workspaceId: rec.workspaceId, sessionId, reason },
    });
  }

  private reapIdle(): void {
    const now = Date.now();
    for (const [id, rec] of this.sessions) {
      if (now - rec.lastActivityAt < this.cfg.idleTtlMs) continue;
      this.logger.info?.(`[VoiceService] Reaping idle STT session id=${id}`);
      rec.runner.cancel();
      this.endSession(id, 'idle_timeout');
    }
  }

  private async emit(sessionId: string, event: AgentEvent): Promise<void> {
    try {
      const scopeSession = `${this.cfg.eventBusScopePrefix}:${sessionId}`;
      await this.eventBus.emit(scopeSession, event);
    } catch (err) {
      this.logger.warn?.(`[VoiceService] emit failed sessionId=${sessionId}: ${(err as Error).message}`);
    }
  }
}

/**
 * Best-effort classification for telemetry/`describe()` only — never used
 * for behavior. Uses `includes` rather than `startsWith` because
 * `CascadingSttEngine.name` reports `cascading:parakeet:<id>|whisper:<id>`
 * (candidate names joined) until its first `load()` resolves and it starts
 * reporting whichever candidate actually won.
 */
function sttEngineKindOf(engine: ISpeechToTextEngine): SttEngineKind {
  return engine.name.includes('parakeet') ? 'parakeet' : 'whisper';
}

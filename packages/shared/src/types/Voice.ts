// ────────────────────────────────────────────────────────────────
// Voice — Voice Module value objects (pure TS)
//
// A voice session (STT today; TTS from Phase 3) is an ephemeral resource
// exposed to clients over WebSocket, mirroring Terminal.ts's shape for the
// same reason VoiceService mirrors TerminalService/BrowserService: an
// in-memory Map, no DB table, cleared on server restart.
//
// Unlike Browser/Terminal sessions, an STT dictation session is NOT
// workspace-scoped — the chat composer's mic button works even when the
// chat has no attached project/workspace (see AGENTS.md domain model: a
// Chat's ExecutionWorkspace is optional). `workspaceId` below is therefore
// always nullable and is carried for observability only; it is never the
// lookup key.
//
// Consumed by:
//   • packages/core/src/services/VoiceService
//   • apps/server/src/stt-ws.ts (STT transport) + apps/server/src/tts-ws.ts (TTS transport, Phase 3)
//   • apps/web/src/hooks/useSpeechToText.ts, apps/web/src/hooks/useTextToSpeech.ts (Phase 3)
//   • apps/mobile/src/voice/useVoiceInput.ts
//
// Zero external imports — this file lives in @generatorai/shared.
// ────────────────────────────────────────────────────────────────

/**
 * Which STT engine produced a transcript. Surfaced for telemetry/debug only.
 *
 * Every engine the factory can build has to appear here. It listed only the
 * original two for a while after Moonshine and Nemotron were added, and
 * because the classifier falls back to `'whisper'` for anything it does not
 * recognise, every session on the actual default engine was reported as
 * Whisper — which made the one signal that says which engine is really
 * serving dictation say the opposite of the truth.
 */
export type SttEngineKind = 'whisper' | 'parakeet' | 'moonshine' | 'nemotron' | 'disabled';

/** Lifecycle state of one STT dictation session (client + server keep this in lockstep). */
export type SttSessionStatus = 'listening' | 'paused' | 'finalizing';

/** Public descriptor for one active STT session. Not persisted. */
export interface SttSessionDescriptor {
  id: string;
  /** Nullable — see file header. */
  workspaceId: string | null;
  engine: SttEngineKind;
  status: SttSessionStatus;
  createdAt: number;
  lastActivityAt: number;
}

/**
 * Client → server control frames on `/api/stt/stream`. Binary WS frames are
 * strictly raw 16 kHz mono Float32 PCM audio and are not part of this union.
 */
export type SttClientFrame =
  | { t: 'start'; lang?: string }
  | { t: 'stop' }
  | { t: 'cancel' }
  /**
   * Phase 1 (pause/resume — VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part
   * C.3) — additive, backward compatible with the original
   * start/stop/cancel-only protocol. `pause` suspends audio consumption
   * WITHOUT tearing the engine down (keeps the model warm, no re-negotiation
   * on resume); `resume` continues the SAME session. A client that never
   * sends these frames (e.g. the mobile single-shot record/transcribe flow)
   * is completely unaffected.
   */
  | { t: 'pause' }
  | { t: 'resume' };

/** Server → client frames on `/api/stt/stream` (JSON only). */
export type SttServerFrame =
  | { t: 'ready' }
  /** Best-effort live partial for the currently-open (not yet finalized) segment. */
  | { t: 'interim'; text: string }
  /**
   * Phase 1 — a segment reached end-of-utterance (native EOU endpointing)
   * while the session is still listening. Unlike `final`, more of these can
   * follow within the same session. The client inserts this text at the
   * composer's current caret position (Part C.2) — interim text is never
   * inserted into the real editable buffer, only `segment`/`final` text is.
   */
  | { t: 'segment'; text: string }
  /** Final transcript after an explicit `stop` (flushes any open segment). */
  | { t: 'final'; text: string }
  | { t: 'error'; message: string }
  /** Phase 1 — acks so the client can render the paused/listening state. */
  | { t: 'paused' }
  | { t: 'resumed' };

/**
 * Phase 3 — client → server control frames on `/api/tts/stream`. There is
 * no binary input on this route (all input is the text to speak).
 */
export type TtsClientFrame =
  | { t: 'speak'; text: string }
  /** Phase 4 — barge-in: stop synthesis/playback immediately. */
  | { t: 'stop' };

/**
 * Phase 3 — server → client frames on `/api/tts/stream`. Binary WS frames
 * are raw Float32 PCM audio chunks at `sampleRate`, in speech order.
 */
export type TtsServerFrame =
  | { t: 'ready'; sampleRate: number | null }
  | { t: 'done' }
  | { t: 'error'; message: string };

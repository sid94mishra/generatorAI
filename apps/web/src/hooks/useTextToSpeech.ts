// ────────────────────────────────────────────────────────────────
// useTextToSpeech — voice output hook (web + desktop).
//
// Phase 3 (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part E): "read this
// message aloud." Opens a WebSocket to the local server's TTS engine
// (`/api/tts/stream`), sends the text once, and plays back the raw Float32
// PCM audio chunks as they arrive — scheduled back-to-back via Web Audio
// API so playback is gapless even though each chunk arrives as a separate
// WS frame (see `scheduleChunk` below).
//
// Phase 4 adds `speakStream(sessionId)`: the same connection and the same
// gapless playback, but the server subscribes to that chat session's live
// `harness.token` EventBus stream and synthesizes sentence-by-sentence as
// the agent generates — "the agent talks while it works". From this hook's
// side the only difference is which frame is sent on open, which is why
// both go through one `startSession`.
//
// Identical on web and in the Electron desktop renderer — same reasoning
// as useSpeechToText.ts: both just need the `media`/audio-output
// permission the OS/browser already grants for `<audio>`/AudioContext
// playback (no special Electron main-process grant needed, unlike the mic
// which needs `media` permission — audio OUTPUT isn't gated the same way).
//
// Everything runs locally: text goes to the loopback server, Kokoro
// synthesizes on-device, no cloud / key / cost.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildAuthenticatedSocketUrl } from '../platform/authTransport.js';

export type TtsStatus = 'idle' | 'connecting' | 'speaking' | 'error';

/**
 * Cross-instance coordination (Phase 3+4 review finding). Each
 * `AssistantMessage` owns its own `useTextToSpeech()` instance, so with no
 * shared state at all, clicking "Read aloud" on message B while message A
 * is still speaking left A's WebSocket/AudioContext running untouched —
 * both play back at once. This module-level singleton holds whichever
 * instance's `stop` is currently "the one speaking," so a new `speak()`
 * anywhere in the tab can barge over it, mirroring the barge-over-self
 * behavior a single instance already has for its own repeated `speak()`
 * calls. Module-level (not context-based) because every `AssistantMessage`
 * in the whole app should share ONE "who's talking" slot regardless of
 * where in the tree it's rendered — there's exactly one pair of speakers.
 */
const activeSpeaker: { stop: (() => void) | null } = { stop: null };

export interface UseTextToSpeechOptions {
  /** Fired on any error (engine unavailable, connection failure, …). */
  onError?: (message: string) => void;
}

/** The one frame that differs between the two entry points. */
type SpeakFrame =
  | { t: 'speak'; text: string }
  | { t: 'speak_stream'; sessionId: string };

export interface UseTextToSpeech {
  isSupported: boolean;
  status: TtsStatus;
  error: string | null;
  /** Synthesize and play `text`. Resolves once the WHOLE utterance has finished playing (or was stopped). */
  speak: (text: string) => Promise<void>;
  /**
   * Phase 4 — speak this chat SESSION's agent output LIVE, as it is
   * generated, rather than waiting for a finished message. `sessionId` is the
   * chat's `sessionId` (the same value used as StreamPanel's `streamKey`),
   * not its chat id. Resolves when the turn ends (or was stopped). Barges
   * over any in-flight `speak`/`speakStream` exactly like `speak` does.
   */
  speakStream: (sessionId: string) => Promise<void>;
  /** Barge-in (Part E Phase 4) — stop synthesis/playback immediately. */
  stop: () => void;
}

function ttsWebSocketUrl(): Promise<string> {
  // Pass a PATH, not an absolute URL. `buildSocketUrl` prepends the runtime's
  // own endpoint, so handing it `http://host:3100/api/...` produced
  // `http://host:3100http://host:3100/api/...` and threw
  // "Failed to construct 'URL': Invalid URL" — so read-aloud never opened a
  // socket at all and surfaced only as a generic error toast. Every other
  // socket caller
  // (TerminalPanel, BrowserPanel) already passes a bare path.
  //
  // This also removes the hardcoded dev port: Vite's `/api` proxy sets
  // `ws: true`, so the upgrade is forwarded to the server in dev exactly as
  // it is served same-origin in production.
  //
  // The socket carries synthesized speech, so it is authorised the same way as
  // every other stream: a 30-second single-use ticket.
  return buildAuthenticatedSocketUrl('/api/tts/stream', { scope: 'tts', id: null });
}

export function useTextToSpeech(options: UseTextToSpeechOptions = {}): UseTextToSpeech {
  const { onError } = options;

  const isSupported =
    typeof window !== 'undefined' &&
    typeof window.WebSocket !== 'undefined' &&
    (typeof window.AudioContext !== 'undefined' ||
      typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined');

  const [status, setStatus] = useState<TtsStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const cbRef = useRef({ onError });
  cbRef.current = { onError };

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  /** Wall-clock (AudioContext time) at which the next scheduled chunk should start — keeps playback gapless. */
  const nextStartTimeRef = useRef(0);
  const stoppedRef = useRef(false);
  const pendingResolveRef = useRef<(() => void) | null>(null);
  /**
   * The 'done' handler below defers its actual teardown by `remainingMs` so
   * already-scheduled audio finishes playing first. That timer's id is
   * tracked here so `teardown()` — called unconditionally at the top of
   * every new `speak()` — can cancel it. Without this, a still-pending
   * timer from utterance A would fire during utterance B's playback and
   * tear down/resolve B (whichever ws/ctx/resolve happen to be "current" at
   * fire time), cutting B's audio off out of nowhere.
   */
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const teardown = useCallback(() => {
    if (doneTimerRef.current !== null) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING)) {
      try { ws.close(); } catch { /* ignore */ }
    }
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => undefined);
      ctxRef.current = null;
    }
  }, []);

  const scheduleChunk = useCallback((ctx: AudioContext, sampleRate: number, pcm: Float32Array) => {
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    // `pcm` is always backed by a real ArrayBuffer here (constructed from a
    // WebSocket binary message, never a SharedArrayBuffer) — lib.dom's
    // stricter typed-array generics just can't express that narrowing.
    buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify({ t: 'stop' })); } catch { /* ignore */ }
    }
    teardown();
    setStatus('idle');
    pendingResolveRef.current?.();
    pendingResolveRef.current = null;
    // Release the "who's talking" slot — but only if it's still this
    // instance's; a `stop()` that lost a barge-in race to a newer speak()
    // (this instance's OR another instance's) must not clear the slot out
    // from under whoever is speaking now.
    if (activeSpeaker.stop === stop) activeSpeaker.stop = null;
  }, [teardown]);

  /**
   * Shared machinery for both entry points. The ONLY difference between
   * "read this finished message" (Phase 3) and "speak this chat live as the
   * agent generates it" (Phase 4) is which frame goes out on open — the
   * connection, the gapless PCM scheduling, the barge-in slot and the
   * teardown are identical, so they are written once.
   */
  const startSession = useCallback(
    (frame: SpeakFrame): Promise<void> => {
      if (!isSupported) {
        const msg = 'Voice output is not supported in this environment.';
        setError(msg);
        setStatus('error');
        cbRef.current.onError?.(msg);
        return Promise.resolve();
      }
      if (frame.t === 'speak' ? !frame.text.trim() : !frame.sessionId) return Promise.resolve();

      // A new speak() while one is already in flight barges over it —
      // mirrors the server's own "second 'speak' before the first finishes" handling.
      // This also barges over a DIFFERENT instance's in-flight speak() (see
      // `activeSpeaker` above) so two assistant messages never talk at once.
      if (activeSpeaker.stop && activeSpeaker.stop !== stop) {
        activeSpeaker.stop();
      }
      activeSpeaker.stop = stop;
      stoppedRef.current = false;
      teardown();
      setError(null);
      setStatus('connecting');

      return new Promise<void>((resolve) => {
        pendingResolveRef.current = resolve;

        void (async () => {
          let ttsUrl: string;
          try {
            ttsUrl = await ttsWebSocketUrl();
          } catch (err) {
            const msg = `Voice output is not permitted for this device: ${(err as Error).message}`;
            setError(msg);
            setStatus('error');
            cbRef.current.onError?.(msg);
            resolve();
            return;
          }
          if (stoppedRef.current) {
            resolve();
            return;
          }

          const AudioCtor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new AudioCtor();
          ctxRef.current = ctx;
          nextStartTimeRef.current = 0;

          const ws = new WebSocket(ttsUrl);
          ws.binaryType = 'arraybuffer';
          wsRef.current = ws;

          let sampleRate = 24_000; // overwritten by the server's 'ready' frame before any audio arrives

          ws.onopen = () => {
            try { ws.send(JSON.stringify(frame)); } catch { /* ignore */ }
          };
          ws.onmessage = (e) => {
            if (e.data instanceof ArrayBuffer) {
              if (stoppedRef.current) return;
              const pcm = new Float32Array(e.data);
              if (pcm.length) scheduleChunk(ctx, sampleRate, pcm);
              setStatus('speaking');
              return;
            }
            let msg: { t?: string; sampleRate?: number; message?: string };
            try { msg = JSON.parse(e.data as string); } catch { return; }
            switch (msg.t) {
              case 'ready':
                if (msg.sampleRate) sampleRate = msg.sampleRate;
                break;
              case 'done': {
                // Let whatever's already scheduled finish playing before tearing down.
                const remainingMs = Math.max(0, (nextStartTimeRef.current - ctx.currentTime) * 1000);
                doneTimerRef.current = setTimeout(() => {
                  doneTimerRef.current = null;
                  teardown();
                  setStatus('idle');
                  pendingResolveRef.current?.();
                  pendingResolveRef.current = null;
                  if (activeSpeaker.stop === stop) activeSpeaker.stop = null;
                }, remainingMs);
                break;
              }
              case 'error': {
                const m = msg.message ?? 'Voice output failed.';
                setError(m);
                cbRef.current.onError?.(m);
                teardown();
                setStatus('error');
                pendingResolveRef.current?.();
                pendingResolveRef.current = null;
                if (activeSpeaker.stop === stop) activeSpeaker.stop = null;
                break;
              }
              default:
                break;
            }
          };
          ws.onerror = () => {
            const m = 'Voice output connection failed.';
            setError(m);
            cbRef.current.onError?.(m);
            teardown();
            setStatus('error');
            pendingResolveRef.current?.();
            pendingResolveRef.current = null;
            if (activeSpeaker.stop === stop) activeSpeaker.stop = null;
          };
        })();
      });
    },
    [isSupported, teardown, scheduleChunk, stop],
  );

  const speak = useCallback(
    (text: string): Promise<void> => startSession({ t: 'speak', text }),
    [startSession],
  );

  const speakStream = useCallback(
    (sessionId: string): Promise<void> => startSession({ t: 'speak_stream', sessionId }),
    [startSession],
  );

  useEffect(
    () => () => {
      teardown();
      if (activeSpeaker.stop === stop) activeSpeaker.stop = null;
    },
    [teardown, stop],
  );

  return { isSupported, status, error, speak, speakStream, stop };
}

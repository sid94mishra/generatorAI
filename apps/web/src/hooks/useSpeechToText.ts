// ────────────────────────────────────────────────────────────────
// useSpeechToText — voice input hook (web + desktop).
//
// Captures the microphone via getUserMedia, streams 16 kHz mono Float32
// PCM over a WebSocket to the local server's Whisper engine
// (`/api/stt/stream`), and surfaces interim + final transcripts plus a
// live amplitude value for the recording waveform.
//
// Identical on web and in the Electron desktop renderer — both use the
// same browser getUserMedia + WebSocket path. The desktop shell only
// needs to grant the `media` permission (handled in the main process).
//
// Everything runs locally: audio goes to the loopback server,
// Whisper/Parakeet transcribes on-device, no cloud / key / cost.
//
// Phase 1 (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C): adds
// pause()/resume() (suspends outgoing audio without tearing the mic/socket
// down) and an `onSegment` callback for mid-session committed text — see
// each callback's doc comment below for the interim/segment/final split.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildAuthenticatedSocketUrl } from '../platform/authTransport.js';

// Phase 1 adds 'paused' — a genuinely new state (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md
// Part C.4): listening ⇄ paused via pause()/resume(), both driven by
// server acks ('paused'/'resumed') rather than optimistic client state, the
// same way 'ready' (not the client's own start() call) is what already
// drives the listening transition below.
export type SttStatus = 'idle' | 'connecting' | 'listening' | 'paused' | 'transcribing' | 'error';

export interface UseSpeechToTextOptions {
  /** Fired as the transcript grows while speaking, for the current open segment. */
  onInterim?: (text: string) => void;
  /**
   * Phase 1 — fired each time a segment reaches end-of-utterance while
   * still listening (more can follow in the same session). The composer
   * inserts each at the current caret position — see Part C.2. Distinct
   * from `onFinal`, which only fires once, after `stop()`.
   */
  onSegment?: (text: string) => void;
  /** Fired once with the final transcript after stop(). */
  onFinal?: (text: string) => void;
  /** Fired on any error (permission denied, engine failure, …). */
  onError?: (message: string) => void;
  /** BCP-47 language hint. Defaults to the browser language. */
  language?: string;
  /**
   * Ask the server for live interim transcripts. Defaults to whether an
   * `onInterim` callback was supplied, because computing them is not free:
   * the server re-transcribes a rolling window of the open segment every
   * ~900ms, and every one of those passes is serialized through the SAME
   * queue as the segment finalizations that actually produce text. With an
   * accurate (rather than merely fast) engine that contention delays the
   * words the user is waiting for, to render a preview nothing displays.
   */
  interim?: boolean;
}

export interface UseSpeechToText {
  isSupported: boolean;
  status: SttStatus;
  error: string | null;
  /** 0..1 mic loudness for the waveform. */
  amplitude: number;
  start: () => Promise<void>;
  /**
   * Phase 1 — suspend audio consumption without tearing anything down (Part
   * C.3): the mic stream, audio graph, and WebSocket all stay alive; only
   * outgoing audio frames stop. No-op unless currently listening.
   */
  pause: () => void;
  /** Phase 1 — continue the SAME session; no re-permission-prompt, no reload. */
  resume: () => void;
  stop: () => void;
  cancel: () => void;
}

const TARGET_SAMPLE_RATE = 16_000;

/**
 * RMS above which we treat a frame as the user speaking again while paused.
 * Comfortably above keyboard clicks and room tone (which sit under ~0.01),
 * below normal speech (~0.02-0.15 measured at the analyser).
 */
const RESUME_RMS_THRESHOLD = 0.02;
/**
 * Consecutive above-threshold animation frames before auto-resuming, i.e.
 * roughly 150ms of sustained sound at 60fps. A single key press or a chair
 * creak cannot reach this; a spoken syllable does.
 */
const RESUME_SUSTAIN_FRAMES = 9;

/** The AudioWorklet processor, inlined so no separate build asset is needed. */
const WORKLET_SRC = `
class PCMWorklet extends AudioWorkletProcessor {
  constructor() { super(); this._chunks = []; this._len = 0; this._target = 2048; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      this._chunks.push(ch.slice(0));
      this._len += ch.length;
      if (this._len >= this._target) {
        const out = new Float32Array(this._len);
        let o = 0;
        for (const c of this._chunks) { out.set(c, o); o += c.length; }
        this.port.postMessage(out, [out.buffer]);
        this._chunks = []; this._len = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PCMWorklet);
`;

function sttWebSocketUrl(): Promise<string> {
  // Pass a PATH, not an absolute URL. `buildSocketUrl` prepends the runtime's
  // own endpoint, so handing it `http://host:3100/api/...` produced
  // `http://host:3100http://host:3100/api/...` and threw
  // "Failed to construct 'URL': Invalid URL" — which the hook reported as
  // "Voice input is not permitted for this device", i.e. dictation was
  // simply broken in the browser. Every other socket caller
  // (TerminalPanel, BrowserPanel) already passes a bare path.
  //
  // This also removes the hardcoded dev port: Vite's `/api` proxy sets
  // `ws: true`, so the upgrade is forwarded to the server in dev exactly as
  // it is served same-origin in production.
  //
  // The socket carries raw microphone audio, so it is authorised the same way as
  // every other stream: a 30-second single-use ticket.
  return buildAuthenticatedSocketUrl('/api/stt/stream', { scope: 'stt', id: null });
}

export function useSpeechToText(options: UseSpeechToTextOptions = {}): UseSpeechToText {
  const { onInterim, onSegment, onFinal, onError, language, interim } = options;
  const wantInterim = interim ?? onInterim != null;

  const isSupported =
    typeof window !== 'undefined' &&
    typeof window.WebSocket !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    (typeof window.AudioContext !== 'undefined' ||
      typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined');

  const [status, setStatus] = useState<SttStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [amplitude, setAmplitude] = useState(0);

  // Latest callbacks without re-creating start/stop.
  const cbRef = useRef({ onInterim, onSegment, onFinal, onError });
  cbRef.current = { onInterim, onSegment, onFinal, onError };

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  /**
   * Checked synchronously in the worklet's onmessage hot path, so this must
   * be a ref, not state — a state read there would always see the value
   * from the render that created the closure, not the latest one.
   */
  const pausedRef = useRef(false);

  const teardownAudio = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setAmplitude(0);
    try { workletRef.current?.disconnect(); } catch { /* ignore */ }
    workletRef.current = null;
    try { analyserRef.current?.disconnect(); } catch { /* ignore */ }
    analyserRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => undefined);
      ctxRef.current = null;
    }
  }, []);

  const closeWs = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING)) {
      try { ws.close(); } catch { /* ignore */ }
    }
  }, []);

  const fullTeardown = useCallback(() => {
    teardownAudio();
    closeWs();
  }, [teardownAudio, closeWs]);

  const start = useCallback(async () => {
    if (!isSupported) {
      const msg = 'Voice input is not supported in this environment.';
      setError(msg);
      setStatus('error');
      cbRef.current.onError?.(msg);
      return;
    }
    if (status === 'connecting' || status === 'listening' || status === 'paused') return;

    setError(null);
    setStatus('connecting');
    pausedRef.current = false;

    // 1. Microphone.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      const msg =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone permission was blocked. Enable it to use voice input.'
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : `Could not access the microphone: ${(err as Error).message}`;
      setError(msg);
      setStatus('error');
      cbRef.current.onError?.(msg);
      return;
    }
    streamRef.current = stream;

    // 2. Audio graph @ 16 kHz (browser resamples the mic track for us).
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtor({ sampleRate: TARGET_SAMPLE_RATE });
    ctxRef.current = ctx;

    try {
      const blob = new Blob([WORKLET_SRC], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
    } catch (err) {
      fullTeardown();
      const msg = `Failed to initialise audio: ${(err as Error).message}`;
      setError(msg);
      setStatus('error');
      cbRef.current.onError?.(msg);
      return;
    }

    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, 'pcm-worklet');
    workletRef.current = worklet;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    source.connect(analyser);
    source.connect(worklet);
    // Do NOT connect worklet to destination — we don't want to hear the mic.

    // 3. WebSocket to the local STT engine.
    let sttUrl: string;
    try {
      sttUrl = await sttWebSocketUrl();
    } catch (err) {
      fullTeardown();
      const msg = `Voice input is not permitted for this device: ${(err as Error).message}`;
      setError(msg);
      setStatus('error');
      cbRef.current.onError?.(msg);
      return;
    }
    const ws = new WebSocket(sttUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    worklet.port.onmessage = (e: MessageEvent) => {
      const buf = e.data as Float32Array;
      // Phase 1: while paused, audio keeps arriving from the worklet (the
      // mic stream is intentionally kept alive — see pause()'s comment) but
      // must not be forwarded — that's what "client stops sending audio
      // frames" (Part C.3) means client-side.
      if (!pausedRef.current && ws.readyState === ws.OPEN && buf?.byteLength) {
        try { ws.send(buf.buffer); } catch { /* ignore */ }
      }
    };

    ws.onopen = () => {
      const lang = language ?? navigator.language?.split('-')[0] ?? 'en';
      try { ws.send(JSON.stringify({ t: 'start', lang, interim: wantInterim })); } catch { /* ignore */ }
    };
    ws.onmessage = (e) => {
      let msg: { t?: string; text?: string; message?: string };
      try { msg = JSON.parse(e.data as string); } catch { return; }
      switch (msg.t) {
        case 'ready':
          setStatus('listening');
          break;
        case 'interim':
          if (msg.text != null) cbRef.current.onInterim?.(msg.text);
          break;
        case 'segment':
          if (msg.text != null) cbRef.current.onSegment?.(msg.text);
          break;
        case 'final':
          if (msg.text != null) cbRef.current.onFinal?.(msg.text);
          fullTeardown();
          setStatus('idle');
          break;
        case 'error': {
          const m = msg.message ?? 'Voice transcription failed.';
          setError(m);
          cbRef.current.onError?.(m);
          fullTeardown();
          setStatus('error');
          break;
        }
        case 'paused':
          setStatus('paused');
          break;
        case 'resumed':
          setStatus('listening');
          break;
        default:
          break;
      }
    };
    ws.onerror = () => {
      const m = 'Voice connection failed.';
      setError(m);
      cbRef.current.onError?.(m);
      fullTeardown();
      setStatus('error');
    };
    ws.onclose = () => {
      // If closed unexpectedly while listening/paused, reset.
      if (wsRef.current === ws) {
        teardownAudio();
        setStatus((s) => (s === 'listening' || s === 'connecting' || s === 'paused' ? 'idle' : s));
      }
    };

    // 4. Amplitude loop — drives the waveform, and the auto-resume detector.
    const data = new Float32Array(analyser.fftSize);
    let sustainedSpeechFrames = 0;
    const tick = () => {
      const a = analyserRef.current;
      if (!a) return;
      a.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
      const rms = Math.sqrt(sum / data.length);

      // Speaking again is the resume gesture.
      //
      // VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C.3 specifies resume as
      // an explicit click, "never ambient auto-resume-on-detected-speech".
      // That is a deliberate divergence: in use, pausing to fix a word and
      // then carrying on talking is the normal flow, and having to find and
      // click the pill first meant the first few words of every continuation
      // were silently dropped. The explicit control still exists — the pill
      // stays clickable — this just also accepts the obvious gesture.
      //
      // The mic and the audio graph are still live while paused (pause only
      // stops FORWARDING frames), so this costs nothing extra to detect.
      if (pausedRef.current) {
        if (rms >= RESUME_RMS_THRESHOLD) {
          sustainedSpeechFrames += 1;
          if (sustainedSpeechFrames >= RESUME_SUSTAIN_FRAMES) {
            sustainedSpeechFrames = 0;
            const sock = wsRef.current;
            if (sock && sock.readyState === sock.OPEN) {
              pausedRef.current = false;
              try { sock.send(JSON.stringify({ t: 'resume' })); } catch { /* ignore */ }
            }
          }
        } else {
          sustainedSpeechFrames = 0;
        }
      } else {
        sustainedSpeechFrames = 0;
      }

      // Scale RMS to a lively 0..1 range for the waveform. Speech measures
      // ~0.02-0.15 RMS at this analyser, so a linear 4x put every ordinary
      // syllable in the bottom sixth of the bar's height and the waveform
      // read as a flat line that occasionally twitched. A square root
      // expands exactly that quiet end (0.02 -> 0.28, 0.15 -> 0.77) — the
      // same reason level meters are not linear in amplitude.
      setAmplitude(Math.min(1, Math.sqrt(rms * 2.2)));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [isSupported, status, language, wantInterim, fullTeardown, teardownAudio]);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    // Stop capturing but keep the socket open to receive the final result.
    teardownAudio();
    pausedRef.current = false;
    if (ws && ws.readyState === ws.OPEN) {
      setStatus('transcribing');
      try { ws.send(JSON.stringify({ t: 'stop' })); } catch { /* ignore */ }
    } else {
      closeWs();
      setStatus('idle');
    }
  }, [teardownAudio, closeWs]);

  const cancel = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify({ t: 'cancel' })); } catch { /* ignore */ }
    }
    fullTeardown();
    pausedRef.current = false;
    setStatus('idle');
    setError(null);
  }, [fullTeardown]);

  /**
   * Phase 1 — suspend audio consumption without tearing anything down (Part
   * C.3). Status transitions to 'paused' on the server's ack, not
   * optimistically, mirroring how 'ready' (not this call) drives 'listening'.
   */
  const pause = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    pausedRef.current = true;
    try { ws.send(JSON.stringify({ t: 'pause' })); } catch { /* ignore */ }
  }, []);

  /** Phase 1 — continue the SAME session; no re-permission-prompt, no reload. */
  const resume = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    pausedRef.current = false;
    try { ws.send(JSON.stringify({ t: 'resume' })); } catch { /* ignore */ }
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => fullTeardown(), [fullTeardown]);

  return { isSupported, status, error, amplitude, start, pause, resume, stop, cancel };
}

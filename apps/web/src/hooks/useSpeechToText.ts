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
// Everything runs locally: audio goes to the loopback server, Whisper
// transcribes on-device, no cloud / key / cost.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildAuthenticatedSocketUrl } from '../platform/authTransport.js';

export type SttStatus = 'idle' | 'connecting' | 'listening' | 'transcribing' | 'error';

export interface UseSpeechToTextOptions {
  /** Fired as the transcript grows while speaking. */
  onInterim?: (text: string) => void;
  /** Fired once with the final transcript after stop(). */
  onFinal?: (text: string) => void;
  /** Fired on any error (permission denied, engine failure, …). */
  onError?: (message: string) => void;
  /** BCP-47 language hint. Defaults to the browser language. */
  language?: string;
}

export interface UseSpeechToText {
  isSupported: boolean;
  status: SttStatus;
  error: string | null;
  /** 0..1 mic loudness for the waveform. */
  amplitude: number;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

const TARGET_SAMPLE_RATE = 16_000;

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
  // In the Vite dev server the API/WS live on the server port 3100; in the
  // packaged web/desktop build they're same-origin. `import.meta.env.DEV`
  // is robust to whatever port Vite picks (5173, 5174, …).
  const isDev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  const origin = isDev
    ? `${window.location.protocol}//${window.location.hostname}:3100`
    : window.location.origin;
  // The socket carries raw microphone audio, so it is authorised the same way
  // as every other stream: a 30-second single-use ticket.
  return buildAuthenticatedSocketUrl(`${origin}/api/stt/stream`, { scope: 'stt', id: null });
}

export function useSpeechToText(options: UseSpeechToTextOptions = {}): UseSpeechToText {
  const { onInterim, onFinal, onError, language } = options;

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
  const cbRef = useRef({ onInterim, onFinal, onError });
  cbRef.current = { onInterim, onFinal, onError };

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

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
    if (status === 'connecting' || status === 'listening') return;

    setError(null);
    setStatus('connecting');

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
      if (ws.readyState === ws.OPEN && buf?.byteLength) {
        try { ws.send(buf.buffer); } catch { /* ignore */ }
      }
    };

    ws.onopen = () => {
      const lang = language ?? navigator.language?.split('-')[0] ?? 'en';
      try { ws.send(JSON.stringify({ t: 'start', lang })); } catch { /* ignore */ }
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
      // If closed unexpectedly while listening, reset.
      if (wsRef.current === ws) {
        teardownAudio();
        setStatus((s) => (s === 'listening' || s === 'connecting' ? 'idle' : s));
      }
    };

    // 4. Amplitude loop for the waveform.
    const data = new Float32Array(analyser.fftSize);
    const tick = () => {
      const a = analyserRef.current;
      if (!a) return;
      a.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
      const rms = Math.sqrt(sum / data.length);
      // Scale RMS (~0..0.3 speaking) to a lively 0..1 range.
      setAmplitude(Math.min(1, rms * 4));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [isSupported, status, language, fullTeardown, teardownAudio]);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    // Stop capturing but keep the socket open to receive the final result.
    teardownAudio();
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
    setStatus('idle');
    setError(null);
  }, [fullTeardown]);

  // Cleanup on unmount.
  useEffect(() => () => fullTeardown(), [fullTeardown]);

  return { isSupported, status, error, amplitude, start, stop, cancel };
}

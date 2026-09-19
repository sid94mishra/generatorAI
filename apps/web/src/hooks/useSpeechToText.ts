// ────────────────────────────────────────────────────────────────
// useSpeechToText — voice input hook (web + desktop).
//
// Captures the microphone via getUserMedia, streams 16 kHz mono Float32
// PCM over a WebSocket to the local server's speech engine
// (`/api/stt/stream`), and surfaces interim + segment + final transcripts
// plus a live amplitude value for the recording waveform.
//
// Identical on web and in the Electron desktop renderer — both use the
// same browser getUserMedia + WebSocket path. The desktop shell only
// needs to grant the `media` permission (handled in the main process).
//
// Everything runs locally: audio goes to the loopback server, Nemotron /
// Moonshine / Whisper transcribes on-device, no cloud / key / cost.
//
// Phase 1 (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C): adds
// pause()/resume() (suspends outgoing audio without tearing the mic/socket
// down) and an `onSegment` callback for mid-session committed text — see
// each callback's doc comment below for the interim/segment/final split.
//
// PAUSE, AND WHY THE FIRST WORD AFTER IT USED TO VANISH
// -----------------------------------------------------
// Typing into the composer pauses dictation (the composer calls `pause()`),
// and speaking again resumes it. While paused, no audio is forwarded — that
// is what pause means — so the resume decision has to be made from the
// audio itself, and whatever was said BEFORE the decision landed was gone.
// The previous detector wanted nine consecutive animation frames above a
// loudness threshold: a consonant gap in the first word reset the count, so
// the resume typically fired on the SECOND word, and the first was never
// sent anywhere. Reported verbatim as "the first word is never registered".
//
// Two changes fix it. The last second of audio is kept in a ring buffer
// while paused, and on resume it is sent AHEAD of the live audio, so the
// server hears the onset that triggered the resume rather than what came
// after it. And the onset detector runs on the capture frames themselves
// (128 ms each) rather than on animation frames, so it still works in a
// background tab and is not defeated by a gap between syllables.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
// A real, same-origin asset rather than a `blob:` URL built at runtime — see
// the file's own header for why that distinction decided whether dictation
// worked at all outside the dev server.
import pcmWorkletUrl from '../audio/pcm-worklet.js?url';
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
  /**
   * Which microphone to record from — a `MediaDeviceInfo.deviceId`, or
   * `null`/omitted for whatever the operating system calls the default input.
   *
   * Dictation used to pass no constraint at all, which meant the OS default
   * and nothing else: someone wearing a headset while the machine's default
   * was still the built-in microphone had no way to record from the headset
   * except changing it system-wide. The choice is resolved and stored by
   * `micPrefsStore`; this hook only consumes it.
   *
   * Requested with `ideal`, not `exact`, on purpose. `exact` makes
   * `getUserMedia` reject outright when the device has just been unplugged,
   * which turns a missing headset into no dictation at all; `ideal` records
   * from the default instead, which is what the user wants in the moment.
   */
  deviceId?: string | null;
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

/** Samples per capture frame handed over by the worklet — 128 ms at 16 kHz. */
const FRAME_SAMPLES = 2048;

/**
 * Capture frames kept while paused and replayed on resume: 8 × 128 ms ≈ 1 s.
 * Long enough to hold the whole onset of the first word (and the detector's
 * own reaction time), short enough that a resume never replays stale room
 * tone from a long pause.
 */
const PRE_ROLL_FRAMES = 8;

/**
 * RMS above which a capture frame counts as the user speaking again.
 * Comfortably above keyboard clicks and room tone (which average well under
 * 0.01 over a 128 ms frame with the browser's noise suppression on), below
 * normal speech (~0.02-0.15).
 */
const ONSET_RMS = 0.015;
/** Frames the detector looks back over, and how many must be loud. */
const ONSET_WINDOW = 4;
const ONSET_HITS = 2;

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

function frameRms(pcm: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 1) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / (pcm.length || 1));
}

export function useSpeechToText(options: UseSpeechToTextOptions = {}): UseSpeechToText {
  const { onInterim, onSegment, onFinal, onError, language, interim, deviceId } = options;
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
  /** The last ~1s of capture frames while paused — see the file header. */
  const preRollRef = useRef<Float32Array[]>([]);
  /** Recent frame loudness while paused, for the onset detector. */
  const onsetRef = useRef<number[]>([]);

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
    preRollRef.current = [];
    onsetRef.current = [];
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

  /**
   * Leave the paused state: tell the server, then replay the pre-roll so the
   * words that triggered (or preceded) the resume are the first thing the
   * new stream hears. Frame order on the socket is preserved, and the server
   * handles the `resume` control frame before any audio that follows it.
   */
  const resumeNow = useCallback((ws: WebSocket) => {
    pausedRef.current = false;
    try { ws.send(JSON.stringify({ t: 'resume' })); } catch { /* ignore */ }
    const frames = preRollRef.current;
    preRollRef.current = [];
    onsetRef.current = [];
    for (const frame of frames) {
      try { ws.send(frame.buffer); } catch { /* ignore */ }
    }
  }, []);

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
    preRollRef.current = [];
    onsetRef.current = [];

    // 1. Microphone.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
        },
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
      await ctx.audioWorklet.addModule(pcmWorkletUrl);
    } catch (err) {
      fullTeardown();
      // Worth naming the likely cause: every failure here reads the same
      // ("Unable to load a worklet's module") whatever went wrong, and the
      // one that actually happened in production was a Content-Security-
      // Policy refusal, which no part of that sentence hints at.
      const msg = `Failed to initialise audio (${(err as Error).message}). The audio processor at ${pcmWorkletUrl} could not be loaded.`;
      setError(msg);
      setStatus('error');
      cbRef.current.onError?.(msg);
      return;
    }

    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, 'pcm-worklet', {
      processorOptions: { frameSamples: FRAME_SAMPLES },
    });
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
      if (!buf?.length || ws.readyState !== ws.OPEN) return;

      if (!pausedRef.current) {
        try { ws.send(buf.buffer); } catch { /* ignore */ }
        return;
      }

      // Paused: the mic stays live (see pause()) but nothing is forwarded.
      // Keep the last second so a resume can replay it, and watch for the
      // user speaking again — which is the resume gesture.
      //
      // VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C.3 specifies resume as
      // an explicit click, "never ambient auto-resume-on-detected-speech".
      // That is a deliberate divergence: in use, pausing to fix a word and
      // then carrying on talking is the normal flow, and having to find and
      // click the pill first meant the first few words of every continuation
      // were silently dropped. The explicit control still exists — the pill
      // stays clickable — this just also accepts the obvious gesture.
      const ring = preRollRef.current;
      ring.push(buf);
      if (ring.length > PRE_ROLL_FRAMES) ring.shift();
      const recent = onsetRef.current;
      recent.push(frameRms(buf));
      if (recent.length > ONSET_WINDOW) recent.shift();
      let loud = 0;
      for (const v of recent) if (v >= ONSET_RMS) loud += 1;
      if (loud >= ONSET_HITS) resumeNow(ws);
    };

    // A USB headset unplugged mid-sentence ends its track, and nothing was
    // watching for it: the socket stayed open, no audio arrived, the waveform
    // froze at whatever it last drew, and the user was left looking at a
    // "recording" pill attached to a microphone that no longer existed. Flush
    // instead of dropping — whatever was said before the cable came out is
    // still worth keeping — and say what happened.
    const micTrack = stream.getAudioTracks()[0];
    micTrack?.addEventListener('ended', () => {
      if (streamRef.current !== stream) return; // already torn down normally
      teardownAudio();
      if (ws.readyState === ws.OPEN) {
        setStatus('transcribing');
        try { ws.send(JSON.stringify({ t: 'stop' })); } catch { /* ignore */ }
      } else {
        closeWs();
        setStatus('idle');
      }
      cbRef.current.onError?.(
        'The microphone was disconnected. Dictation stopped — anything already captured has been inserted.',
      );
    });

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

    // 4. Amplitude loop — drives the waveform.
    const data = new Float32Array(analyser.fftSize);
    const tick = () => {
      const a = analyserRef.current;
      if (!a) return;
      a.getFloatTimeDomainData(data);
      const rms = frameRms(data);
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
  }, [isSupported, status, language, wantInterim, deviceId, fullTeardown, teardownAudio, closeWs, resumeNow]);

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
    preRollRef.current = [];
    onsetRef.current = [];
    try { ws.send(JSON.stringify({ t: 'pause' })); } catch { /* ignore */ }
  }, []);

  /** Phase 1 — continue the SAME session; no re-permission-prompt, no reload. */
  const resume = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    resumeNow(ws);
  }, [resumeNow]);

  // Cleanup on unmount.
  useEffect(() => () => fullTeardown(), [fullTeardown]);

  return { isSupported, status, error, amplitude, start, pause, resume, stop, cancel };
}

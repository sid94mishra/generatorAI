// ────────────────────────────────────────────────────────────────
// Voice input — LIVE dictation on mobile.
//
// WHAT CHANGED, AND WHY THE OLD DESIGN EXISTED
// --------------------------------------------
// This hook used to record to a WAV FILE, then send the whole file once on
// release, because — as its own header said — "`expo-audio` records to a
// FILE and exposes no sample callback". That was true when it was written.
// It is not true of `expo-audio` 57, which ships `useAudioStream`: a native
// PCM capture stream with an `onBuffer` callback and a `'float32'` encoding
// (see AudioStream.types.d.ts). The premise the batch design rested on is
// gone, so the design goes with it.
//
// Mobile now behaves like the web composer:
//
//   before   hold, release, wait, the whole utterance appears at once
//   now      hold, watch words appear live, segments commit as you pause
//
// and it gains the pause/resume protocol (Part C.3), so tapping into the
// draft to fix a word suspends dictation instead of racing it.
//
// TWO THINGS THE NATIVE STREAM MAKES OUR PROBLEM
// ----------------------------------------------
// `useAudioStream` documents that the delivered `sampleRate` "may differ if
// the hardware cannot deliver it", and reports `channels` per buffer. The
// STT endpoint accepts only 16 kHz mono Float32. Sending a 48 kHz buffer
// unconverted does not error — it transcribes to nothing — so every buffer
// goes through `toMono16k` (see pcm.ts) before it is sent.
//
// AMPLITUDE (D16)
// ---------------
// Loudness used to be React state, set once per audio buffer (~10×/s), which
// re-rendered the whole chat screen for a number nothing displayed. It is
// now a Reanimated shared value — written from `onBuffer`, read on the UI
// thread by the waveform pill — plus an 18-slot ring of recent amplitudes
// for the scrolling waveform. Neither touches React.
//
// Everything still runs on the user's own server: audio goes to the loopback
// / paired host, Parakeet or Whisper transcribes on-device, no cloud.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { AudioModule, setAudioModeAsync, useAudioStream } from 'expo-audio';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { useAuth } from '../auth/AuthProvider';
import { TARGET_SAMPLE_RATE, rms, toMono16k } from './pcm';
import { PLAYBACK_AUDIO_MODE, RECORDING_AUDIO_MODE } from './audioSession';
import { WAVEFORM_BARS } from './dictationCommit';

/**
 * Mirrors the web hook's states (useSpeechToText.ts) so the two composers
 * can be reasoned about together. 'paused' is the genuinely new one —
 * VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C.4.
 */
/** How long the server has to say `ready` after the socket is opened. */
const READY_TIMEOUT_MS = 10_000;
/** How long it has to return `final` after Stop (a long segment on a slow host). */
const FINAL_TIMEOUT_MS = 30_000;

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'paused' | 'transcribing' | 'error';

export interface UseVoiceInputOptions {
  /** Live preview of the open segment. Never committed to the draft (Part C.2). */
  onInterim?: (text: string) => void;
  /** A segment reached end-of-utterance mid-session; insert it at the caret. */
  onSegment?: (text: string) => void;
  /** Fired once after stop(), with whatever was still open. */
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
}

export interface VoiceInput {
  status: VoiceStatus;
  error: string | null;
  /** True when the platform can capture audio at all. */
  supported: boolean;
  /** 0..1 loudness, updated per buffer on the UI thread — never React state. */
  amplitude: SharedValue<number>;
  /** The last `WAVEFORM_BARS` amplitudes, oldest first, for the waveform pill. */
  waveform: SharedValue<number[]>;
  /** Epoch ms the current session started listening, or null. */
  startedAt: number | null;
  start: () => Promise<void>;
  /** Suspend audio without tearing the stream or socket down (Part C.3). */
  pause: () => void;
  /** Continue the SAME session — no re-permission, no model reload. */
  resume: () => void;
  stop: () => void;
  cancel: () => void;
}

const EMPTY_WAVEFORM: number[] = Array.from({ length: WAVEFORM_BARS }, () => 0);

export function useVoiceInput(options: UseVoiceInputOptions = {}): VoiceInput {
  const { socketUrl } = useAuth();
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const amplitude = useSharedValue(0);
  const waveform = useSharedValue<number[]>(EMPTY_WAVEFORM);

  // Callbacks are read through a ref so a caller that passes inline closures
  // (every caller) doesn't re-create the audio stream on every render.
  const cbRef = useRef(options);
  cbRef.current = options;

  const socketRef = useRef<WebSocket | null>(null);
  // A socket that never answers must not leave the composer on a spinner.
  // Two waits have no natural end: the server's `ready` after we connect, and
  // its `final` after we stop. When dictation is switched off on the server
  // the upgrade is simply never answered — no open, no error, no close — and
  // the pill sat on "Transcribing…" until the user cancelled by hand.
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearWatchdog = useCallback(() => {
    if (watchdog.current != null) clearTimeout(watchdog.current);
    watchdog.current = null;
  }, []);
  /** Gate for outgoing audio — flipped by pause()/resume() without teardown. */
  const sendingRef = useRef(false);
  /** Set by cancel(), so a late `final` frame is not applied to the draft. */
  const cancelledRef = useRef(false);
  /** True while this hook holds the audio session in record mode. */
  const recordModeRef = useRef(false);

  const supported = Platform.OS === 'ios' || Platform.OS === 'android';

  const resetLevels = useCallback(() => {
    amplitude.value = 0;
    waveform.value = EMPTY_WAVEFORM;
  }, [amplitude, waveform]);

  /**
   * Native capture. Declared at hook level (not inside start()) because
   * `useAudioStream` is a hook; `stream.start()`/`stop()` are what actually
   * open and close the microphone.
   */
  const { stream } = useAudioStream({
    sampleRate: TARGET_SAMPLE_RATE,
    channels: 1,
    encoding: 'float32',
    onBuffer: (buffer) => {
      if (!sendingRef.current) return;
      const socket = socketRef.current;
      if (!socket || socket.readyState !== 1) return;
      const pcm = toMono16k(buffer.data, buffer.sampleRate, buffer.channels);
      if (pcm.length === 0) return;
      // Loudness lands on the shared values only. RMS of speech sits around
      // 0.05–0.3, so it is lifted onto a 0..1 display range here once,
      // rather than in every worklet that reads it.
      const level = Math.min(1, rms(pcm) * 4);
      amplitude.value = level;
      const prev = waveform.value;
      waveform.value = [...prev.slice(1), level];
      try {
        socket.send(pcm.buffer as ArrayBuffer);
      } catch {
        /* socket closed under us; the close handler resets state */
      }
    },
  });

  const teardown = useCallback(() => {
    clearWatchdog();
    sendingRef.current = false;
    try {
      stream.stop();
    } catch {
      /* not streaming */
    }
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    }
    resetLevels();
    setStartedAt(null);
    // Hand the session back in playback mode. Left in record mode, the next
    // read-aloud came out of the receiver — or not at all with the silent
    // switch on (iOS). Only undone if this hook changed it.
    if (recordModeRef.current) {
      recordModeRef.current = false;
      void setAudioModeAsync(PLAYBACK_AUDIO_MODE).catch(() => undefined);
    }
  }, [stream, resetLevels, clearWatchdog]);

  const fail = useCallback(
    (message: string) => {
      teardown();
      setStatus('error');
      setError(message);
      cbRef.current.onError?.(message);
    },
    [teardown],
  );

  const start = useCallback(async () => {
    if (!supported) {
      fail('Dictation needs a device microphone.');
      return;
    }
    setError(null);
    cancelledRef.current = false;
    setStatus('connecting');

    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        fail('Microphone access is off for GeneratorAI. Turn it on in Settings.');
        return;
      }
      // Without this the capture is silent on iOS when the device is in
      // silent mode — the single most common "the mic is broken" report for
      // any RN app.
      await setAudioModeAsync(RECORDING_AUDIO_MODE);
      recordModeRef.current = true;

      const url = await socketUrl('/api/stt/stream', 'stt', null);
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;
      clearWatchdog();
      watchdog.current = setTimeout(() => {
        if (socketRef.current === socket) {
          fail('The transcription service did not answer. Dictation may be switched off on your server.');
        }
      }, READY_TIMEOUT_MS);

      socket.onopen = () => {
        socket.send(JSON.stringify({ t: 'start' }));
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let frame: { t?: string; text?: string; message?: string };
        try {
          frame = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (frame.t) {
          case 'ready':
            clearWatchdog();
            // The server, not our own start() call, is what moves us to
            // listening — same rule as the web hook.
            sendingRef.current = true;
            setStatus('listening');
            setStartedAt(Date.now());
            void stream.start().catch((err: unknown) => fail((err as Error).message));
            break;
          case 'interim':
            cbRef.current.onInterim?.(frame.text ?? '');
            break;
          case 'segment':
            // Committed mid-session text. The OLD batch implementation
            // ignored these and read only `final`, which silently dropped
            // everything before the last pause in a long dictation.
            if (!cancelledRef.current && frame.text) cbRef.current.onSegment?.(frame.text);
            break;
          case 'final':
            if (!cancelledRef.current && frame.text) cbRef.current.onFinal?.(frame.text);
            teardown();
            setStatus('idle');
            break;
          case 'paused':
            setStatus('paused');
            break;
          case 'resumed':
            setStatus('listening');
            break;
          case 'error':
            fail(frame.message ?? 'Transcription failed.');
            break;
          default:
            break;
        }
      };

      socket.onerror = () => fail('Could not reach the transcription service.');
      socket.onclose = () => {
        // Only a close we did not initiate is interesting; teardown() has
        // already cleared the ref in the paths we drive.
        if (socketRef.current === socket) {
          teardown();
          setStatus('idle');
        }
      };
    } catch (err) {
      fail((err as Error).message);
    }
  }, [supported, fail, socketUrl, stream, teardown, clearWatchdog]);

  const pause = useCallback(() => {
    if (status !== 'listening') return;
    // Stop sending immediately rather than waiting for the ack: the point of
    // pausing is that words spoken while the user is editing must not land.
    sendingRef.current = false;
    amplitude.value = 0;
    const socket = socketRef.current;
    if (socket?.readyState === 1) socket.send(JSON.stringify({ t: 'pause' }));
  }, [status, amplitude]);

  const resume = useCallback(() => {
    if (status !== 'paused') return;
    sendingRef.current = true;
    const socket = socketRef.current;
    if (socket?.readyState === 1) socket.send(JSON.stringify({ t: 'resume' }));
  }, [status]);

  const stop = useCallback(() => {
    if (status === 'idle' || status === 'error') return;
    // Stop the mic now, but keep the socket open: the server still owes us a
    // `final` for whatever segment is still open.
    sendingRef.current = false;
    try {
      stream.stop();
    } catch {
      /* not streaming */
    }
    resetLevels();
    setStatus('transcribing');
    const socket = socketRef.current;
    if (socket?.readyState === 1) {
      socket.send(JSON.stringify({ t: 'stop' }));
      clearWatchdog();
      watchdog.current = setTimeout(() => {
        if (socketRef.current === socket) {
          fail('Transcription took too long. What was already added to your message is kept.');
        }
      }, FINAL_TIMEOUT_MS);
    } else {
      teardown();
      setStatus('idle');
    }
  }, [status, stream, teardown, resetLevels, clearWatchdog, fail]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const socket = socketRef.current;
    if (socket?.readyState === 1) socket.send(JSON.stringify({ t: 'cancel' }));
    teardown();
    setStatus('idle');
  }, [teardown]);

  // A screen that unmounts mid-dictation must not leave the microphone hot.
  useEffect(() => () => teardown(), [teardown]);

  return {
    status,
    error,
    supported,
    amplitude,
    waveform,
    startedAt,
    start,
    pause,
    resume,
    stop,
    cancel,
  };
}

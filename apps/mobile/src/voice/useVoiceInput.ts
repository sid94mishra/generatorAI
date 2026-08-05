// ────────────────────────────────────────────────────────────────
// Voice input — hold to dictate.
//
// The mic button in the composer used to render enabled and do nothing:
// `voiceAvailable` was computed from the scope, but no handler was ever
// passed. This is the handler.
//
// The server's STT endpoint (`ws /api/stt/stream`) wants raw 16 kHz mono
// Float32 PCM. The web client can produce that live from an AudioWorklet;
// React Native cannot — `expo-audio` records to a FILE and exposes no sample
// callback. So the shape of the interaction changes rather than being faked:
//
//   web     hold, watch the words appear, release
//   mobile  hold, release, the utterance is transcribed
//
// That is the honest mapping, it uses the same local Whisper on the same
// machine, and it needs no server change. What we record is uncompressed
// 16 kHz mono PCM in a WAV container, which is exactly what the endpoint
// wants once the 44-byte header is stripped and the samples are scaled.
// ────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system';

import { useAuth } from '../auth/AuthProvider';

/** Whisper's native rate. Anything else has to be resampled server-side. */
const SAMPLE_RATE = 16_000;

// Channel count and bit rate are only accepted at the top level; the platform
// sub-objects reject them.
const WAV_16K_MONO: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.wav',
  sampleRate: SAMPLE_RATE,
  numberOfChannels: 1,
  bitRate: SAMPLE_RATE * 16,
  android: {
    extension: '.wav',
    outputFormat: 'default',
    audioEncoder: 'default',
    sampleRate: SAMPLE_RATE,
  },
  ios: {
    extension: '.wav',
    // Linear PCM is the point: a compressed container would have to be
    // decoded before the samples could be sent.
    audioQuality: 0x7f,
    outputFormat: 'lpcm',
    sampleRate: SAMPLE_RATE,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

export type VoiceStatus = 'idle' | 'recording' | 'transcribing' | 'error';

export interface VoiceInput {
  status: VoiceStatus;
  error: string | null;
  /** True when the platform can record at all — false in the web preview. */
  supported: boolean;
  start: () => Promise<void>;
  /** Resolves with the transcript, or null if nothing was said. */
  stop: () => Promise<string | null>;
  cancel: () => Promise<void>;
}

export function useVoiceInput(): VoiceInput {
  const { socketUrl } = useAuth();
  const recorder = useAudioRecorder(WAV_16K_MONO);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const supported = Platform.OS === 'ios' || Platform.OS === 'android';

  const start = useCallback(async () => {
    setError(null);
    cancelled.current = false;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setStatus('error');
        setError('Microphone access is off for GeneratorAI. Turn it on in Settings.');
        return;
      }
      // Without this the recording is silent on iOS when the device is in
      // silent mode, which is the single most common "the mic is broken"
      // report for any RN app.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStatus('recording');
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  }, [recorder]);

  const cancel = useCallback(async () => {
    cancelled.current = true;
    try {
      await recorder.stop();
    } catch {
      /* already stopped */
    }
    setStatus('idle');
  }, [recorder]);

  const stop = useCallback(async (): Promise<string | null> => {
    if (status !== 'recording') return null;
    setStatus('transcribing');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri || cancelled.current) {
        setStatus('idle');
        return null;
      }

      const pcm = await readWavAsFloat32(uri);
      if (pcm.byteLength === 0) {
        setStatus('idle');
        return null;
      }

      const url = await socketUrl('/api/stt/stream', 'stt', null);
      const text = await transcribe(url, pcm);
      setStatus('idle');
      return text.trim() || null;
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
      return null;
    }
  }, [recorder, socketUrl, status]);

  return { status, error, supported, start, stop, cancel };
}

/**
 * Read a 16-bit PCM WAV file and return little-endian Float32 samples.
 *
 * The header is walked rather than assumed to be 44 bytes: iOS writes a
 * `LIST`/`INFO` chunk ahead of `data` often enough that a fixed offset ships
 * a few hundred milliseconds of metadata as audio.
 */
async function readWavAsFloat32(uri: string): Promise<ArrayBuffer> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToBytes(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let offset = 12; // past "RIFF" + size + "WAVE"
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(
      bytes[offset]!,
      bytes[offset + 1]!,
      bytes[offset + 2]!,
      bytes[offset + 3]!,
    );
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      dataStart = offset + 8;
      dataLength = Math.min(size, bytes.byteLength - dataStart);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0) return new ArrayBuffer(0);

  const sampleCount = Math.floor(dataLength / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = view.getInt16(dataStart + i * 2, true) / 32768;
  }
  return out.buffer;
}

/** One request/response over the STT socket. */
function transcribe(url: string, pcm: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';

    // A transcription that never answers must not leave the composer stuck in
    // "transcribing" for the rest of the session.
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Transcription timed out.'));
    }, 60_000);

    const finish = (result: string | Error): void => {
      clearTimeout(timer);
      socket.close();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    socket.onopen = () => {
      socket.send(JSON.stringify({ t: 'start' }));
      socket.send(pcm);
      socket.send(JSON.stringify({ t: 'stop' }));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const frame = JSON.parse(event.data) as { t?: string; text?: string; message?: string };
        if (frame.t === 'final') finish(frame.text ?? '');
        else if (frame.t === 'error') finish(new Error(frame.message ?? 'Transcription failed.'));
      } catch {
        /* ignore malformed frames */
      }
    };

    socket.onerror = () => finish(new Error('Could not reach the transcription service.'));
    socket.onclose = () => clearTimeout(timer);
  });
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decode base64 without `atob`.
 *
 * Hermes has no `atob`, and the per-character `String.fromCharCode` loop used
 * elsewhere in this app is what makes the browser-preview frame decode
 * expensive. This writes straight into a typed array.
 */
function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const length = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(length);

  let byte = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = B64.indexOf(clean[i]!);
    if (value < 0) continue;
    byte = (byte << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (byte >> bits) & 0xff;
    }
  }
  return out.subarray(0, written);
}

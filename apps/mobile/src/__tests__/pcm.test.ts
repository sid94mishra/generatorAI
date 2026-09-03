// ────────────────────────────────────────────────────────────────
// pcm.ts — the conversion between what the phone's microphone actually
// delivers and the single shape the STT endpoint accepts.
//
// This is tested directly rather than through the hook because the failure
// mode is silent: a wrong sample rate does not throw, it transcribes to
// nothing (verified against the real model — 44.1kHz audio fed to Parakeet
// returned an empty string, not an error). A test is the only thing that
// notices.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { TARGET_SAMPLE_RATE, downmixToMono, rms, resampleLinear, toMono16k } from '../voice/pcm';

/** Build an ArrayBuffer of float32 samples, as `onBuffer` hands us. */
function buffer(samples: number[]): ArrayBuffer {
  return Float32Array.from(samples).buffer;
}

describe('downmixToMono', () => {
  it('passes mono through untouched', () => {
    const mono = Float32Array.from([0.1, 0.2, 0.3]);
    expect(downmixToMono(mono, 1)).toBe(mono);
  });

  it('averages interleaved stereo rather than dropping a channel', () => {
    // [L,R, L,R] → [(L+R)/2, …]. Averaging matters: on a two-mic device the
    // speech can be louder on either one, so keeping only channel 0 throws
    // away half the signal.
    const stereo = Float32Array.from([1, 0, 0.5, 0.5, -1, 1]);
    expect(Array.from(downmixToMono(stereo, 2))).toEqual([0.5, 0.5, 0]);
  });

  it('handles a trailing partial frame without producing NaN', () => {
    const ragged = Float32Array.from([1, 1, 1]); // 1.5 stereo frames
    const out = downmixToMono(ragged, 2);
    expect(out.length).toBe(1);
    expect(Number.isNaN(out[0]!)).toBe(false);
  });
});

describe('resampleLinear', () => {
  it('returns the input unchanged when the rate already matches', () => {
    const pcm = Float32Array.from([0.1, 0.2]);
    expect(resampleLinear(pcm, 16_000, 16_000)).toBe(pcm);
  });

  it('downsamples 48kHz to 16kHz at exactly one third the length', () => {
    const pcm = new Float32Array(4_800); // 100ms at 48kHz
    expect(resampleLinear(pcm, 48_000, 16_000).length).toBe(1_600); // 100ms at 16kHz
  });

  it('preserves a ramp, so the signal is interpolated rather than decimated', () => {
    // 0,1,2,3 at 4Hz → 0,2 at 2Hz: the output tracks the input's shape.
    const ramp = Float32Array.from([0, 1, 2, 3]);
    expect(Array.from(resampleLinear(ramp, 4, 2))).toEqual([0, 2]);
  });

  it('interpolates between samples rather than snapping to the nearest', () => {
    const out = resampleLinear(Float32Array.from([0, 1]), 2, 4);
    // Midpoints must appear; a nearest-neighbour implementation would give
    // [0, 0, 1, 1].
    expect(out[1]).toBeGreaterThan(0);
    expect(out[1]).toBeLessThan(1);
  });

  it('never returns a negative-length buffer for a tiny input', () => {
    expect(resampleLinear(Float32Array.from([0.5]), 48_000, 16_000).length).toBe(0);
    expect(resampleLinear(new Float32Array(0), 48_000, 16_000).length).toBe(0);
  });
});

describe('toMono16k', () => {
  it('normalizes a 48kHz stereo buffer to 16kHz mono', () => {
    // 48 interleaved stereo samples = 24 frames @48kHz = 8 frames @16kHz.
    const interleaved = Array.from({ length: 48 }, (_, i) => (i % 2 === 0 ? 1 : -1));
    const out = toMono16k(buffer(interleaved), 48_000, 2);
    expect(out.length).toBe(8);
    // Every stereo pair is [1,-1], so the mono average is 0 throughout.
    expect(out.every((v) => Math.abs(v) < 1e-6)).toBe(true);
  });

  it('passes an already-correct 16kHz mono buffer through unchanged', () => {
    const samples = [0.1, -0.2, 0.3, -0.4];
    expect(Array.from(toMono16k(buffer(samples), TARGET_SAMPLE_RATE, 1))).toEqual(
      samples.map((v) => Math.fround(v)),
    );
  });

  it('downmixes BEFORE resampling', () => {
    // Resampling interleaved data would blend the two channels into each
    // other and produce noise. With L=+1 and R=-1 throughout, a correct
    // pipeline yields silence; an incorrect one yields a ±1 waveform.
    const interleaved = Array.from({ length: 96 }, (_, i) => (i % 2 === 0 ? 1 : -1));
    const out = toMono16k(buffer(interleaved), 48_000, 2);
    expect(Math.max(...Array.from(out, Math.abs))).toBeLessThan(1e-6);
  });

  it('trims a buffer whose byte length is not a whole number of float32s', () => {
    // A short/ragged native buffer must cost us that chunk's tail, not the
    // whole chunk via a constructor throw.
    const ragged = new ArrayBuffer(10); // 2 floats + 2 stray bytes
    expect(() => toMono16k(ragged, TARGET_SAMPLE_RATE, 1)).not.toThrow();
    expect(toMono16k(ragged, TARGET_SAMPLE_RATE, 1).length).toBe(2);
  });

  it('returns empty for a buffer too short to hold a single sample', () => {
    expect(toMono16k(new ArrayBuffer(2), TARGET_SAMPLE_RATE, 1).length).toBe(0);
  });
});

describe('rms', () => {
  it('is zero for silence and for an empty buffer', () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it('rises with loudness and stays within 0..1', () => {
    const quiet = rms(Float32Array.from({ length: 100 }, () => 0.1));
    const loud = rms(Float32Array.from({ length: 100 }, () => 0.9));
    expect(loud).toBeGreaterThan(quiet);
    expect(loud).toBeLessThanOrEqual(1);
  });

  it('clamps a hot signal to 1 rather than reporting above full scale', () => {
    expect(rms(Float32Array.from({ length: 10 }, () => 3))).toBe(1);
  });
});

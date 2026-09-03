// ────────────────────────────────────────────────────────────────
// EnergyVad — pure DSP unit tests. No mocks, no timers: this class is a
// deterministic function of the sample data it's fed plus its own sample
// counters, so it's tested directly against synthetic Float32Arrays.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { EnergyVad } from '../EnergyVad.js';

function voiced(n: number, amplitude = 0.5): Float32Array {
  return new Float32Array(n).fill(amplitude);
}
function silence(n: number): Float32Array {
  return new Float32Array(n);
}

describe('EnergyVad', () => {
  it('never triggers on leading silence alone (before any voiced audio)', () => {
    const vad = new EnergyVad({ sampleRate: 16_000, silenceHangoverMs: 700 });
    expect(vad.pushChunk(silence(50_000))).toBe(0); // way more than one hangover's worth
  });

  it('does not trigger while voiced audio keeps arriving', () => {
    const vad = new EnergyVad({ sampleRate: 16_000, silenceHangoverMs: 700 });
    for (let i = 0; i < 20; i++) {
      expect(vad.pushChunk(voiced(2_000))).toBe(0);
    }
  });

  it('triggers once sustained silence reaches the hangover threshold after voiced audio, reporting the trailing silence sample count', () => {
    const vad = new EnergyVad({ sampleRate: 16_000, silenceHangoverMs: 700 }); // 11_200 samples
    expect(vad.pushChunk(voiced(16_000))).toBe(0);
    expect(vad.pushChunk(silence(5_000))).toBe(0); // 5000 < 11200, not yet
    const result = vad.pushChunk(silence(6_200)); // 5000+6200 = 11200, exactly at threshold
    expect(result).toBe(11_200);
  });

  it('does not trigger again below the threshold on the sample immediately before crossing it', () => {
    const vad = new EnergyVad({ sampleRate: 16_000, silenceHangoverMs: 700 });
    vad.pushChunk(voiced(16_000));
    expect(vad.pushChunk(silence(11_199))).toBe(0);
    expect(vad.pushChunk(silence(1))).toBe(11_200);
  });

  it('resets after triggering — a second utterance in the same instance gets independent detection', () => {
    const vad = new EnergyVad({ sampleRate: 16_000, silenceHangoverMs: 700 });
    vad.pushChunk(voiced(16_000));
    expect(vad.pushChunk(silence(11_200))).toBe(11_200);

    // Immediately after triggering, more silence must NOT immediately
    // re-trigger — everVoiced was reset, so this is "leading silence" again.
    expect(vad.pushChunk(silence(20_000))).toBe(0);

    // A fresh utterance still works normally.
    vad.pushChunk(voiced(8_000));
    expect(vad.pushChunk(silence(11_200))).toBe(11_200);
  });

  it('a chunk that is itself voiced resets any accumulated silence run', () => {
    const vad = new EnergyVad({ sampleRate: 16_000, silenceHangoverMs: 700 });
    vad.pushChunk(voiced(16_000));
    vad.pushChunk(silence(10_000)); // most of the way to 11_200, but not there
    vad.pushChunk(voiced(1_000)); // speech resumes — silence run must reset to 0
    // Now it takes a FULL fresh 11_200 of silence, not just 1_200 more.
    expect(vad.pushChunk(silence(1_200))).toBe(0);
    expect(vad.pushChunk(silence(10_000))).toBe(11_200);
  });

  it('reset() clears state manually (used by pause()/cancel() in SttSessionRunner)', () => {
    const vad = new EnergyVad({ sampleRate: 16_000, silenceHangoverMs: 700 });
    vad.pushChunk(voiced(16_000));
    vad.pushChunk(silence(9_000));
    vad.reset();
    expect(vad.pushChunk(silence(11_200))).toBe(0); // leading silence again post-reset
  });

  it('honors a custom silenceThreshold — low-amplitude audio below it counts as silence', () => {
    const vad = new EnergyVad({ sampleRate: 16_000, silenceHangoverMs: 700, silenceThreshold: 0.2 });
    expect(vad.pushChunk(voiced(16_000, 0.05))).toBe(0); // "voiced" here is quieter than the threshold
    // Since 0.05 < 0.2, this never counted as voiced — leading silence rule applies.
    expect(vad.pushChunk(silence(20_000))).toBe(0);
  });

  it('a zero-length chunk is treated as silence of zero duration — no NaN, no false trigger, no false voiced state', () => {
    const vad = new EnergyVad({ sampleRate: 16_000, silenceHangoverMs: 700 });
    // Before any voiced audio: a 0-length chunk is leading silence (harmless).
    expect(vad.pushChunk(new Float32Array(0))).toBe(0);
    // After voiced audio: a 0-length chunk contributes 0 toward the
    // hangover — it must not itself trigger, and must not corrupt the
    // running count for the real silence that follows.
    vad.pushChunk(voiced(16_000));
    expect(vad.pushChunk(new Float32Array(0))).toBe(0);
    expect(vad.pushChunk(silence(11_200))).toBe(11_200); // unaffected by the empty chunk
  });

  it('honors a custom sampleRate when converting hangover ms to samples', () => {
    const vad = new EnergyVad({ sampleRate: 8_000, silenceHangoverMs: 700 }); // 5_600 samples
    vad.pushChunk(voiced(4_000));
    expect(vad.pushChunk(silence(5_599))).toBe(0);
    expect(vad.pushChunk(silence(1))).toBe(5_600);
  });
});

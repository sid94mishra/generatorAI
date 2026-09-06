// ────────────────────────────────────────────────────────────────
// nemotronFeatures — the mel front end's conventions.
//
// These are the tests that matter for this engine, because a mel front end
// fails SILENTLY: get the scale or the normalization wrong and the model
// still loads, still runs, and still emits confident, fluent, wrong words.
// There is no exception to catch and no shape mismatch to notice. So the
// conventions are pinned here as values, against the definitions they come
// from, rather than being asserted end to end against a 700MB download.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  NEMOTRON_FEATURES,
  NEMOTRON_CHUNK_FRAMES,
  NEMOTRON_WINDOW_FRAMES,
  NEMOTRON_FFT_BINS,
  hzToMel,
  melToHz,
  hannWindow,
  melFilterbank,
  detokenize,
  parseVocab,
} from '../nemotronFeatures.js';

describe('nemotronFeatures — the encoder input contract', () => {
  it('derives the encoder window the ONNX graph actually demands', () => {
    // The encoder's `audio_signal` input is a FIXED [1, 65, 128]; onnxruntime
    // rejects anything else. 65 is not a magic number — it is 56 frames of
    // new audio (8960 samples / 160 hop) plus the 9 frames of left context
    // the model's own config calls `pre_encode_cache_size`.
    expect(NEMOTRON_CHUNK_FRAMES).toBe(56);
    expect(NEMOTRON_WINDOW_FRAMES).toBe(65);
    expect(NEMOTRON_FFT_BINS).toBe(257);
    expect(NEMOTRON_FEATURES.nMels).toBe(128);
  });

  it('consumes exactly 560ms of audio per streaming step', () => {
    expect(NEMOTRON_FEATURES.chunkSamples / NEMOTRON_FEATURES.sampleRate).toBeCloseTo(0.56, 6);
  });
});

describe('nemotronFeatures — the Slaney mel scale', () => {
  it('is linear below 1kHz at 200/3 Hz per mel', () => {
    expect(hzToMel(0)).toBe(0);
    expect(hzToMel(200)).toBeCloseTo(3, 10);
    expect(hzToMel(500)).toBeCloseTo(7.5, 10);
  });

  it('meets its logarithmic half at exactly 15 mel', () => {
    // The seam in the piecewise definition. Both branches must agree here or
    // the filterbank develops a discontinuity right in the middle of speech.
    expect(hzToMel(1000)).toBeCloseTo(15, 10);
    expect(melToHz(15)).toBeCloseTo(1000, 10);
  });

  it('round-trips across both branches', () => {
    for (const hz of [0, 100, 999, 1000, 1001, 4000, 8000]) {
      expect(melToHz(hzToMel(hz))).toBeCloseTo(hz, 6);
    }
  });

  it('is NOT the HTK scale', () => {
    // The other common convention, 2595*log10(1+hz/700), is what you get from
    // librosa with htk=True and from most tutorials. At 4kHz the two differ
    // by more than a factor of two, which is the difference between correct
    // transcripts and fluent nonsense.
    const htk = 2595 * Math.log10(1 + 4000 / 700);
    expect(Math.abs(hzToMel(4000) - htk)).toBeGreaterThan(10);
  });
});

describe('nemotronFeatures — the filterbank', () => {
  const filters = melFilterbank();

  it('has one row per mel bin and one column per rfft bin', () => {
    expect(filters).toHaveLength(NEMOTRON_FEATURES.nMels * NEMOTRON_FFT_BINS);
  });

  it('is everywhere non-negative', () => {
    for (const v of filters) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('gives every filter exactly one peak', () => {
    // Triangles. A second peak would mean the edges were mis-ordered.
    for (let m = 0; m < NEMOTRON_FEATURES.nMels; m += 1) {
      const row = filters.subarray(m * NEMOTRON_FFT_BINS, (m + 1) * NEMOTRON_FFT_BINS);
      let rises = 0;
      for (let k = 1; k < row.length; k += 1) {
        if ((row[k] as number) > (row[k - 1] as number)) {
          if (k > 1 && (row[k - 1] as number) === 0 && (row[k - 2] as number) > 0) rises += 1;
          else if (k === 1 || (row[k - 1] as number) === 0) rises += 1;
        }
      }
      expect(rises).toBeLessThanOrEqual(1);
    }
  });

  it('normalizes to unit AREA, not unit peak', () => {
    // Slaney normalization scales each triangle by 2/(f[i+2]-f[i]), so its
    // integral is 1 and its height varies inversely with its width. Without
    // it — unit-PEAK triangles — every row would top out at exactly 1.0 and
    // the wide high-frequency filters would swamp the spectrum.
    //
    // Checked on a filter wide enough to be properly resolved: summing the
    // weights and multiplying by the bin width approximates the integral.
    const binWidth = NEMOTRON_FEATURES.sampleRate / NEMOTRON_FEATURES.nFft;
    const row = filters.subarray(100 * NEMOTRON_FFT_BINS, 101 * NEMOTRON_FFT_BINS);
    let area = 0;
    for (const v of row) area += v * binWidth;
    expect(area).toBeCloseTo(1, 1);
    // And no row is a unit-peak triangle.
    expect(Math.max(...row)).toBeLessThan(1);
  });

  it('makes narrow low filters taller than wide high ones', () => {
    const peak = (m: number): number =>
      Math.max(...filters.subarray(m * NEMOTRON_FFT_BINS, (m + 1) * NEMOTRON_FFT_BINS));
    expect(peak(60)).toBeGreaterThan(peak(120));
  });

  it('gives every mel band some weight', () => {
    // 128 bands across 0-8kHz put the lowest filters ~23Hz apart, narrower
    // than the 31.25Hz FFT resolution, so this is the configuration where
    // librosa would warn about empty filters. It does not happen here — every
    // band still catches at least one bin — and that is worth pinning: an
    // empty band is a silently dead input feature, and a wrong fmin/fmax or
    // nMels is exactly how one appears.
    for (let m = 0; m < NEMOTRON_FEATURES.nMels; m += 1) {
      let sum = 0;
      for (const v of filters.subarray(m * NEMOTRON_FFT_BINS, (m + 1) * NEMOTRON_FFT_BINS)) sum += v;
      expect(sum).toBeGreaterThan(0);
    }
  });

  it('stays inside the configured band', () => {
    // Nothing above fmax (8kHz = the Nyquist bin here) may carry weight.
    const nyquistBin = NEMOTRON_FFT_BINS - 1;
    for (let m = 0; m < NEMOTRON_FEATURES.nMels; m += 1) {
      expect(filters[m * NEMOTRON_FFT_BINS + nyquistBin]).toBe(0);
    }
  });
});

describe('nemotronFeatures — the analysis window', () => {
  it('is symmetric by default, matching torch.hann_window(periodic=false)', () => {
    const w = hannWindow(NEMOTRON_FEATURES.winLength);
    expect(w).toHaveLength(400);
    expect(w[0]).toBeCloseTo(0, 10);
    expect(w[w.length - 1]).toBeCloseTo(0, 10);
    // A symmetric window mirrors exactly; a periodic one does not.
    expect(w[1]).toBeCloseTo(w[w.length - 2] as number, 10);
    // 400 is even, so the peak falls BETWEEN samples 199 and 200 — the window
    // never quite reaches 1.0, and the two centre samples are equal.
    expect(w[199]).toBeCloseTo(w[200] as number, 10);
    expect(Math.max(...w)).toBeCloseTo(1, 3);
  });

  it('differs from the periodic form', () => {
    const symmetric = hannWindow(8, false);
    const periodic = hannWindow(8, true);
    expect(symmetric[1]).not.toBeCloseTo(periodic[1] as number, 6);
  });
});

describe('nemotronFeatures — the tokenizer', () => {
  it('turns the SentencePiece boundary marker into a space', () => {
    // U+2581 marks where a word starts; it is not an underscore and must
    // never survive into the composer.
    const vocab = ['<unk>', '▁hello', '▁wor', 'ld', '▁there'];
    expect(detokenize([1, 2, 3, 4], vocab)).toBe('hello world there');
  });

  it('joins subwords without inserting spaces between them', () => {
    const vocab = ['<unk>', '▁re', 'tries', '▁fail'];
    expect(detokenize([1, 2, 3], vocab)).toBe('retries fail');
  });

  it('drops an unknown id rather than throwing away the utterance', () => {
    const vocab = ['<unk>', '▁ok'];
    expect(detokenize([1, 999], vocab)).toBe('ok');
  });

  it('preserves interior blank pieces, because ids are line numbers', () => {
    // A blank line is still a token id. Filtering it would shift every id
    // after it by one and silently corrupt the whole vocabulary.
    expect(parseVocab('a\n\nb\n')).toEqual(['a', '', 'b']);
  });

  it('drops only trailing newlines', () => {
    expect(parseVocab('a\nb\n\n\n')).toEqual(['a', 'b']);
  });
});

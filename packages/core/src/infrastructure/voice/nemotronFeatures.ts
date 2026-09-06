// ────────────────────────────────────────────────────────────────
// nemotronFeatures — the spec-sensitive half of Nemotron's front end.
//
// WHY THIS IS A SEPARATE MODULE AND NOT INSIDE THE WORKER
// ------------------------------------------------------
// The Nemotron decode loop runs on `VoiceWorkerPool`'s worker thread (see
// NemotronOnnxSttEngine.ts for why it must). That worker's source is an
// inline string, which makes anything living in it effectively untestable.
//
// Almost all of the risk in a mel front end is in *these* functions: the
// mel scale is piecewise, the filters are triangular with a normalization
// that differs between conventions, and getting any of it subtly wrong
// produces a model that still runs and still emits words — just the wrong
// ones. That is the worst possible failure mode, so it is the part that
// gets unit tests.
//
// What stays in the worker is the mechanical remainder: pre-emphasis, a
// windowed FFT, and a matrix multiply against the filterbank this module
// hands it. Those are hot-loop arithmetic with no conventions to get wrong.
//
// THE CONVENTIONS, AND WHERE THEY COME FROM
// -----------------------------------------
// Every constant below is read off the model's own shipped configs rather
// than chosen — `genai_config.json` (the runtime contract) and
// `audio_processor_config.json` (the preprocessing contract) that NVIDIA /
// Microsoft publish alongside the weights:
//
//   sample_rate 16000, n_fft 512, hop 160, win_length 400 (hann),
//   n_mels 128, fmin 0, fmax 8000, preemphasis 0.97, mag_power 2.0,
//   normalize "NA" (no per-feature mean/var normalization), center=true
//
// The mel scale is librosa's `slaney` (htk=False), which is what NeMo's
// `FilterbankFeatures` uses, and the filters carry Slaney normalization
// (each triangle scaled by 2/(f[i+2]-f[i]) so it has unit *area* rather
// than unit peak). Verified end to end: with these settings the reference
// clips decode to their exact reference transcripts; with HTK mel or
// unnormalized triangles they decode to fluent nonsense.
// ────────────────────────────────────────────────────────────────

/**
 * Front-end constants, quoted from the model's shipped `genai_config.json`.
 *
 * These are a contract with the ONNX graphs, not tunables: the encoder's
 * `audio_signal` input is a fixed `[1, 65, 128]`, where 65 =
 * `chunkFrames` (8960/160 = 56) + `preEncodeCacheFrames` (9). Changing any
 * of them without re-exporting the model produces a shape error at best and
 * silent garbage at worst.
 */
export const NEMOTRON_FEATURES = {
  sampleRate: 16_000,
  nFft: 512,
  hopLength: 160,
  winLength: 400,
  nMels: 128,
  fMin: 0,
  fMax: 8_000,
  preemphasis: 0.97,
  /** log(x + eps); the value the shipped runtime config specifies (2^-24). */
  logEpsilon: 5.96046448e-8,
  /** Samples the encoder consumes per streaming step (560ms). */
  chunkSamples: 8_960,
  /** Mel frames of left context prepended to each chunk. */
  preEncodeCacheFrames: 9,
} as const;

/** Mel frames produced per streaming chunk: 8960 / 160. */
export const NEMOTRON_CHUNK_FRAMES = NEMOTRON_FEATURES.chunkSamples / NEMOTRON_FEATURES.hopLength;
/** Frames in one encoder input window: 56 new + 9 of left context. */
export const NEMOTRON_WINDOW_FRAMES = NEMOTRON_CHUNK_FRAMES + NEMOTRON_FEATURES.preEncodeCacheFrames;
/** Number of rfft bins for `nFft`: 512/2 + 1. */
export const NEMOTRON_FFT_BINS = NEMOTRON_FEATURES.nFft / 2 + 1;

/**
 * Slaney mel scale (librosa `htk=False`).
 *
 * Linear at 200/3 Hz per mel below 1 kHz, logarithmic above it. The two
 * pieces meet at exactly 15 mel, which is why that constant appears in both
 * directions rather than being derived — it is the definition's own seam.
 */
export function hzToMel(hz: number): number {
  const linearStep = 200 / 3;
  if (hz < 1000) return hz / linearStep;
  return 15 + Math.log(hz / 1000) / (Math.log(6.4) / 27);
}

/** Inverse of {@link hzToMel}. */
export function melToHz(mel: number): number {
  const linearStep = 200 / 3;
  if (mel < 15) return mel * linearStep;
  return 1000 * Math.exp((mel - 15) * (Math.log(6.4) / 27));
}

/**
 * A Hann window.
 *
 * `periodic: false` (the default) is the symmetric window NeMo builds with
 * `torch.hann_window(win_length, periodic=False)`. The difference from the
 * periodic form is a single sample in the denominator and it is audible in
 * the features, so it is spelled out rather than left to a default.
 */
export function hannWindow(length: number, periodic = false): Float32Array {
  const window = new Float32Array(length);
  const denominator = periodic ? length : length - 1;
  for (let i = 0; i < length; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denominator);
  }
  return window;
}

/**
 * The mel filterbank, flattened row-major as `[nMels][fftBins]`.
 *
 * Flattened because its only consumer is a worker-thread matrix multiply
 * reached through `structuredClone`; a single Float32Array crosses that
 * boundary as one buffer instead of 128 of them.
 */
export function melFilterbank(): Float32Array {
  const { sampleRate, nFft, nMels, fMin, fMax } = NEMOTRON_FEATURES;
  const bins = NEMOTRON_FFT_BINS;
  const binHz = new Float64Array(bins);
  for (let k = 0; k < bins; k += 1) binHz[k] = (k * sampleRate) / nFft;

  // nMels + 2 edges: each filter spans a (lower, centre, upper) triple, so
  // adjacent filters overlap by half.
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);
  const edges = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i += 1) {
    edges[i] = melToHz(melMin + ((melMax - melMin) * i) / (nMels + 1));
  }

  const filters = new Float32Array(nMels * bins);
  for (let m = 0; m < nMels; m += 1) {
    const lower = edges[m] as number;
    const centre = edges[m + 1] as number;
    const upper = edges[m + 2] as number;
    // Slaney normalization: unit AREA, not unit peak. Without it the higher
    // (wider) filters dominate and the model mishears systematically.
    const areaNorm = 2.0 / (upper - lower);
    for (let k = 0; k < bins; k += 1) {
      const hz = binHz[k] as number;
      let weight = 0;
      if (hz >= lower && hz <= centre && centre > lower) weight = (hz - lower) / (centre - lower);
      else if (hz > centre && hz <= upper && upper > centre) weight = (upper - hz) / (upper - centre);
      filters[m * bins + k] = weight * areaNorm;
    }
  }
  return filters;
}

/**
 * Turn SentencePiece ids back into text.
 *
 * `▁` (U+2581) is SentencePiece's word-boundary marker, not an underscore —
 * it marks where a space belongs, so it becomes one and the result is
 * trimmed. Unknown ids map to nothing rather than throwing: a single bad id
 * should cost one subword, not the whole utterance.
 */
export function detokenize(ids: readonly number[], vocab: readonly string[]): string {
  let out = '';
  for (const id of ids) out += vocab[id] ?? '';
  return out.split('▁').join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse the shipped `vocab.txt`, one piece per line, line number = token id.
 *
 * Trailing newlines are dropped, but interior blank lines are NOT: a blank
 * piece is still a valid id and removing it would shift every id after it.
 */
export function parseVocab(text: string): string[] {
  const lines = text.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

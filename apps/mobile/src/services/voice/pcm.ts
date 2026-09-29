// ────────────────────────────────────────────────────────────────
// pcm — pure audio conversion for mobile live dictation.
//
// `expo-audio`'s `useAudioStream` delivers whatever the hardware will
// actually give us, and says so explicitly: "The actual rate may differ if
// the hardware cannot deliver it", with `sampleRate` and `channels` reported
// per buffer. The STT endpoint accepts exactly one shape — 16 kHz mono
// Float32 — so every buffer has to be normalised before it goes on the wire.
//
// Getting this wrong is silent, not loud: feeding a 48 kHz buffer to a
// 16 kHz model produces a confident transcript of nothing in particular
// (verified during this work — a 44.1 kHz clip fed to Parakeet returned an
// empty string rather than an error). So the conversion is separated from
// the React hook and tested directly.
// ────────────────────────────────────────────────────────────────

/** What the STT WebSocket expects, and what Parakeet/Whisper are fed. */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Average interleaved channels down to mono.
 *
 * `[L, R, L, R, …]` → `[(L+R)/2, …]`. Averaging rather than taking channel 0
 * because on a device with two mics the speech can be louder on either one,
 * and dropping a channel throws away half the signal-to-noise.
 */
export function downmixToMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const out = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += interleaved[frame * channels + c] ?? 0;
    out[frame] = sum / channels;
  }
  return out;
}

/**
 * Resample by linear interpolation.
 *
 * Linear (not windowed-sinc) is the right trade here: the input is speech
 * band-limited well below 8 kHz, the models are robust to the mild aliasing
 * this introduces, and it costs one multiply-add per output sample on a
 * phone CPU that is also encoding and sending audio in real time. A
 * higher-order filter would buy accuracy the ASR cannot use.
 */
export function resampleLinear(pcm: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || pcm.length === 0) return pcm;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(pcm.length / ratio);
  if (outLength <= 0) return new Float32Array(0);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const low = Math.floor(pos);
    const high = Math.min(low + 1, pcm.length - 1);
    const frac = pos - low;
    out[i] = (pcm[low] ?? 0) * (1 - frac) + (pcm[high] ?? 0) * frac;
  }
  return out;
}

/**
 * Normalise one captured buffer to 16 kHz mono Float32, ready to send.
 *
 * Downmix BEFORE resampling: resampling interleaved data would blend
 * adjacent channels into each other and produce noise rather than speech.
 */
export function toMono16k(
  data: ArrayBuffer,
  sampleRate: number,
  channels: number,
): Float32Array {
  // A buffer whose length is not a whole number of float32s would make the
  // Float32Array constructor throw; trim rather than lose the whole chunk.
  const usable = data.byteLength - (data.byteLength % 4);
  if (usable <= 0) return new Float32Array(0);
  const samples = new Float32Array(data, 0, usable / 4);
  const mono = downmixToMono(samples, channels);
  return resampleLinear(mono, sampleRate, TARGET_SAMPLE_RATE);
}

/** 0..1 loudness, for the recording indicator. */
export function rms(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 1) sum += pcm[i]! * pcm[i]!;
  return Math.min(1, Math.sqrt(sum / pcm.length));
}

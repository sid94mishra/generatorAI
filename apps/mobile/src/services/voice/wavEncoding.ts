// ────────────────────────────────────────────────────────────────
// wavEncoding — pure PCM/WAV helpers used by useTextToSpeech.ts.
//
// Deliberately has ZERO expo-audio / expo-file-system / react-native
// imports so it's unit-testable in a plain Node environment (mobile's
// vitest config runs with `environment: 'node'` and no RN/expo mocking —
// see vitest.config.ts's own comment: "Only the platform-agnostic logic is
// unit-tested here"). `useTextToSpeech.ts` is the thin wrapper that adds
// the WebSocket/expo-audio orchestration around these transforms.
// ────────────────────────────────────────────────────────────────

/**
 * Concatenate Float32 (range [-1, 1]) PCM chunks into one Int16 buffer,
 * clamping out-of-range samples.
 */
export function floatChunksToInt16(chunks: ArrayBuffer[]): Int16Array {
  const totalFloatSamples = chunks.reduce((sum, c) => sum + c.byteLength / 4, 0);
  const pcm16 = new Int16Array(totalFloatSamples);
  let offset = 0;
  for (const chunk of chunks) {
    const floats = new Float32Array(chunk);
    for (let i = 0; i < floats.length; i++) {
      const s = Math.max(-1, Math.min(1, floats[i]!));
      pcm16[offset++] = s < 0 ? s * 32768 : s * 32767;
    }
  }
  return pcm16;
}

/** Standard 44-byte PCM WAV header (mono, 16-bit). */
export function buildWavHeader(dataLength: number, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (16-bit mono → 2 bytes/sample)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);
  return buffer;
}

/** Combine WAV parts (header + PCM payload) into one byte buffer. */
export function assembleWavBytes(header: ArrayBuffer, pcm16: Int16Array): Uint8Array {
  const bytes = new Uint8Array(header.byteLength + pcm16.byteLength);
  bytes.set(new Uint8Array(header), 0);
  bytes.set(new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength), header.byteLength);
  return bytes;
}

// ────────────────────────────────────────────────────────────────
// wavEncoding.ts — pure PCM/WAV/base64 helpers used by useTextToSpeech.ts.
// Zero expo-audio / expo-file-system dependency, so no mocking needed —
// consistent with vitest.config.ts's "only platform-agnostic logic is
// unit-tested here" convention.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { assembleWavBytes, buildWavHeader, floatChunksToInt16 } from '../voice/wavEncoding';

describe('assembleWavBytes', () => {
  it('concatenates the header and PCM payload in order, with no gap or overlap', () => {
    // A 4-byte (even-length) header, matching the real 44-byte WAV header's
    // alignment — an odd-length header would leave the PCM payload at a
    // byte offset Int16Array can't be constructed at.
    const header = new Uint8Array([1, 2, 3, 4]).buffer;
    const pcm16 = new Int16Array([100, -100, 200]);
    const result = assembleWavBytes(header, pcm16);

    expect(result.byteLength).toBe(4 + pcm16.byteLength);
    expect(Array.from(result.subarray(0, 4))).toEqual([1, 2, 3, 4]);
    const reread = new Int16Array(result.buffer, result.byteOffset + 4, 3);
    expect(Array.from(reread)).toEqual([100, -100, 200]);
  });

  it('handles an empty header', () => {
    const pcm16 = new Int16Array([1, 2, 3]);
    const result = assembleWavBytes(new ArrayBuffer(0), pcm16);
    expect(result.byteLength).toBe(pcm16.byteLength);
  });
});

describe('floatChunksToInt16', () => {
  it('scales [-1, 1] floats to the full Int16 range', () => {
    const chunk = new Float32Array([0, 1, -1, 0.5, -0.5]).buffer;
    const result = floatChunksToInt16([chunk]);
    expect(Array.from(result)).toEqual([0, 32767, -32768, 16383, -16384]);
  });

  it('clamps out-of-range samples instead of wrapping/overflowing', () => {
    const chunk = new Float32Array([1.5, -1.5, 2, -2]).buffer;
    const result = floatChunksToInt16([chunk]);
    expect(Array.from(result)).toEqual([32767, -32768, 32767, -32768]);
  });

  it('concatenates multiple chunks in order', () => {
    const c1 = new Float32Array([0, 0.5]).buffer;
    const c2 = new Float32Array([-0.5, 1]).buffer;
    const result = floatChunksToInt16([c1, c2]);
    expect(result.length).toBe(4);
    expect(result[2]).toBe(-16384);
    expect(result[3]).toBe(32767);
  });

  it('returns an empty array for no chunks', () => {
    expect(floatChunksToInt16([]).length).toBe(0);
  });
});

describe('buildWavHeader', () => {
  it('produces a standard 44-byte RIFF/WAVE header with the given sample rate and data length', () => {
    const header = buildWavHeader(1000, 24_000);
    const view = new DataView(header);
    const readStr = (offset: number, len: number) =>
      String.fromCharCode(...Array.from({ length: len }, (_, i) => view.getUint8(offset + i)));

    expect(header.byteLength).toBe(44);
    expect(readStr(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 1000);
    expect(readStr(8, 4)).toBe('WAVE');
    expect(readStr(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(24_000); // sample rate
    expect(view.getUint32(28, true)).toBe(24_000 * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readStr(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(1000);
  });

  it('a header + PCM payload is a well-formed WAV file readable by a standard parser', () => {
    const pcm16 = floatChunksToInt16([new Float32Array([0, 0.5, -0.5, 1]).buffer]);
    const header = buildWavHeader(pcm16.byteLength, 24_000);
    const wav = new Uint8Array(header.byteLength + pcm16.byteLength);
    wav.set(new Uint8Array(header), 0);
    wav.set(new Uint8Array(pcm16.buffer), header.byteLength);

    // Minimal hand-parse: read the header back and confirm it matches the payload we wrote.
    const view = new DataView(wav.buffer);
    const dataLength = view.getUint32(40, true);
    expect(dataLength).toBe(pcm16.byteLength);
    const samples = new Int16Array(wav.buffer, 44, dataLength / 2);
    expect(Array.from(samples)).toEqual(Array.from(pcm16));
  });
});

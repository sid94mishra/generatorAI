// ────────────────────────────────────────────────────────────────
// readJpegSize — the frame header states each frame's dimensions, and on the
// JPEG path nothing upstream knows them. These pin the marker walk, because a
// naive "find 0xFFC0" search matches inside entropy-coded data and inside a
// thumbnail's own SOF, and reports the wrong size with no error anywhere.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { readJpegSize } from '../jpegSize.js';

/** Builds a minimal but structurally valid JPEG: SOI, segments…, SOF, EOI. */
function jpeg(segments: Array<{ marker: number; payload: Buffer }>): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  for (const seg of segments) {
    const header = Buffer.alloc(4);
    header.writeUInt8(0xff, 0);
    header.writeUInt8(seg.marker, 1);
    header.writeUInt16BE(seg.payload.length + 2, 2);
    parts.push(header, seg.payload);
  }
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

function sofPayload(width: number, height: number): Buffer {
  const buf = Buffer.alloc(6);
  buf.writeUInt8(8, 0);            // sample precision
  buf.writeUInt16BE(height, 1);
  buf.writeUInt16BE(width, 3);
  buf.writeUInt8(3, 5);            // components
  return buf;
}

describe('readJpegSize', () => {
  it('reads a baseline SOF0', () => {
    expect(readJpegSize(jpeg([{ marker: 0xc0, payload: sofPayload(1280, 720) }])))
      .toEqual({ width: 1280, height: 720 });
  });

  it('reads a progressive SOF2', () => {
    expect(readJpegSize(jpeg([{ marker: 0xc2, payload: sofPayload(800, 600) }])))
      .toEqual({ width: 800, height: 600 });
  });

  it('skips APPn and DQT segments rather than mistaking them for a frame header', () => {
    const buf = jpeg([
      { marker: 0xe0, payload: Buffer.from('JFIF\0\0\0\0\0\0', 'latin1') },
      { marker: 0xdb, payload: Buffer.alloc(65) },
      { marker: 0xc0, payload: sofPayload(1920, 1080) },
    ]);
    expect(readJpegSize(buf)).toEqual({ width: 1920, height: 1080 });
  });

  it('does not mistake DHT (0xC4) for a frame header even though it is in the 0xCn range', () => {
    // A range test (`marker >= 0xC0 && marker <= 0xCF`) reads DHT's Huffman
    // table bytes as a width and a height and returns nonsense.
    const dht = Buffer.alloc(30);
    dht.writeUInt16BE(4444, 1);
    dht.writeUInt16BE(5555, 3);
    const buf = jpeg([
      { marker: 0xc4, payload: dht },
      { marker: 0xc0, payload: sofPayload(640, 480) },
    ]);
    expect(readJpegSize(buf)).toEqual({ width: 640, height: 480 });
  });

  it('returns null for non-JPEG bytes instead of throwing', () => {
    expect(readJpegSize(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(readJpegSize(Buffer.alloc(0))).toBeNull();
    expect(readJpegSize(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('returns null for a truncated SOF rather than reading past the buffer', () => {
    const full = jpeg([{ marker: 0xc0, payload: sofPayload(1280, 720) }]);
    expect(readJpegSize(full.subarray(0, full.length - 8))).toBeNull();
  });
});

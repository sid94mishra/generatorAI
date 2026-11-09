// ────────────────────────────────────────────────────────────────
// The simulator helper's `/stream.avcc` wire: a 4-byte big-endian length
// (tag byte + payload), a tag, the payload. Tags: 0x01 avcC description,
// 0x02 keyframe, 0x03 delta frame, 0x04 seed JPEG. Pure, incremental.
// ────────────────────────────────────────────────────────────────

export const AVCC_TAG = { description: 0x01, keyframe: 0x02, delta: 0x03, seed: 0x04 } as const;

export interface AvccEnvelope {
  tag: number;
  payload: Uint8Array;
}

/** Feeds chunks in, hands complete envelopes out; keeps the remainder. */
export class AvccEnvelopeReader {
  private buffer: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): AvccEnvelope[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer, 0);
    joined.set(chunk, this.buffer.length);
    const out: AvccEnvelope[] = [];
    let offset = 0;
    while (joined.length - offset >= 5) {
      const view = new DataView(joined.buffer, joined.byteOffset + offset, 4);
      const length = view.getUint32(0);
      if (length < 1) throw new Error('avcc envelope with zero length');
      if (joined.length - offset - 4 < length) break;
      out.push({ tag: joined[offset + 4]!, payload: joined.slice(offset + 5, offset + 4 + length) });
      offset += 4 + length;
    }
    this.buffer = joined.slice(offset);
    return out;
  }
}

/** The WebCodecs codec string (`avc1.PPCCLL`) of an avcC record, or null. */
export function avcCodecString(avcc: Uint8Array): string | null {
  if (avcc.length < 4 || avcc[0] !== 1) return null;
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `avc1.${hex(avcc[1]!)}${hex(avcc[2]!)}${hex(avcc[3]!)}`;
}

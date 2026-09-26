// ────────────────────────────────────────────────────────────────
// Screencast socket frame header (client half). The layout is documented
// once, on the server, in `apps/server/src/browser-ws.ts`: a 16-byte header —
// magic, version, codec, flags (bit 0 = key frame), width, height (uint16),
// timestamp (float64) — then the encoded payload. Pure.
// ────────────────────────────────────────────────────────────────

export const FRAME_HEADER_BYTES = 16;
const MAGIC = 0x47;
const VERSION = 1;
export const CODEC_JPEG = 0;
export const CODEC_VP8 = 1;

export interface ScreencastFrame {
  codec: number;
  keyframe: boolean;
  width: number;
  height: number;
  timestamp: number;
  payload: Uint8Array<ArrayBuffer>;
}

/**
 * Read a binary frame; null when it is too short or the framing does not
 * match. A mismatch means the peer is not the endpoint we think it is (an old
 * server, a proxy rewriting frames): drop it rather than decode it as video.
 */
export function parseScreencastFrame(buffer: ArrayBuffer): ScreencastFrame | null {
  if (buffer.byteLength <= FRAME_HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== MAGIC || view.getUint8(1) !== VERSION) return null;
  return {
    codec: view.getUint8(2),
    keyframe: (view.getUint8(3) & 1) === 1,
    width: view.getUint16(4),
    height: view.getUint16(6),
    timestamp: view.getFloat64(8),
    payload: new Uint8Array(buffer, FRAME_HEADER_BYTES),
  };
}

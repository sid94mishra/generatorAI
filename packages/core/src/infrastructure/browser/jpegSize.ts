// ────────────────────────────────────────────────────────────────
// readJpegSize — pixel dimensions of a JPEG, from its own header.
//
// The screencast wire format states each frame's width and height so the
// client can size its canvas before it has decoded anything. On the VP8 path
// those come from the encoder (which decoded the image and therefore knows);
// on the JPEG path nothing upstream knows them: CDP's `screencastFrame`
// metadata reports the *viewport* in CSS pixels, which is not the frame size
// whenever the device scale factor is not 1, and Playwright's viewport is what
// we asked for rather than what was delivered.
//
// So we read the JPEG's own SOF marker. This is a parse of a fixed 9-byte
// header inside a marker we locate by walking segment lengths — not a decode;
// it touches a few dozen bytes regardless of image size.
// ────────────────────────────────────────────────────────────────

/**
 * Start-Of-Frame markers. All of them carry the same
 * `[precision:1][height:2][width:2][components:1]` payload; they differ only
 * in the coding process (baseline, progressive, arithmetic, …). DHT (0xC4),
 * JPG (0xC8) and DAC (0xCC) share the 0xCn range but are NOT frame headers,
 * which is why this is an explicit set rather than a range test.
 */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Returns the image dimensions, or `null` for anything that is not a
 * well-formed JPEG. Never throws: it is fed bytes that came off a socket.
 */
export function readJpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // SOI
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) {
      // Fill bytes (0xFF padding) are legal between segments; anything else
      // means we have lost the framing and should stop rather than guess.
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1]!;
    offset += 2;
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > buf.length) return null;
    const length = buf.readUInt16BE(offset);
    if (length < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      // [length:2][precision:1][height:2][width:2]
      if (offset + 7 > buf.length) return null;
      return { height: buf.readUInt16BE(offset + 3), width: buf.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

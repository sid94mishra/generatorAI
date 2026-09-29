// ────────────────────────────────────────────────────────────────
// base64 — the one encoder/decoder for the app.
//
// D15: three files each carried their own copy with contradictory
// assumptions ("Hermes has no btoa" in one, `globalThis.btoa` unguarded in
// another). Hermes on RN 0.86 DOES ship `btoa`/`atob` (RN's polyfill), the
// web build has the browser's, and vitest runs on Node which has both —
// but none of that is worth betting a device signature on, so every entry
// point here checks and falls back to a pure implementation.
//
// `btoa`/`atob` are Latin-1 only. Both helpers below take BYTES, and the
// string variants go through UTF-8 explicitly, so a non-ASCII prompt never
// throws "InvalidCharacterError" at the bridge.
//
// Consumers: src/native/deviceKeyModule.ts (signatures across the bridge),
// `workbench/BrowserSection.tsx` (screencast frames → data URI),
// `terminal/TerminalView.tsx` (PTY bytes ↔ the xterm bridge) and
// `app/chats/[id].tsx` (screenshot lightbox).
// ────────────────────────────────────────────────────────────────

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const DECODE_TABLE: Int16Array = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  // base64url aliases, so a JWT segment decodes too.
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
})();

type Btoa = (binary: string) => string;
type Atob = (encoded: string) => string;

function nativeBtoa(): Btoa | null {
  const fn = (globalThis as { btoa?: unknown }).btoa;
  return typeof fn === 'function' ? (fn as Btoa) : null;
}

function nativeAtob(): Atob | null {
  const fn = (globalThis as { atob?: unknown }).atob;
  return typeof fn === 'function' ? (fn as Atob) : null;
}

/** Pure encoder — used when the host has no `btoa`, and by the tests. */
export function encodeBase64Pure(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      ALPHABET[(n >> 18) & 63]! +
      ALPHABET[(n >> 12) & 63]! +
      ALPHABET[(n >> 6) & 63]! +
      ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '=';
  }
  return out;
}

/** Pure decoder. Accepts standard and url-safe alphabets, with or without padding. */
export function decodeBase64Pure(encoded: string): Uint8Array {
  // Whitespace is tolerated (a PEM-wrapped or pretty-printed payload); anything
  // else outside the alphabet is an error, not silently skipped.
  const clean = encoded.replace(/[\s=]+/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const v = DECODE_TABLE[clean.charCodeAt(i)] ?? -1;
    if (v < 0) throw new Error(`Invalid base64 character at index ${i}`);
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (buffer >> bits) & 0xff;
      o += 1;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

/** Bytes → standard base64 (with padding). */
export function bytesToBase64(bytes: Uint8Array): string {
  const btoaFn = nativeBtoa();
  if (!btoaFn) return encodeBase64Pure(bytes);
  // Chunked: `String.fromCharCode(...bytes)` overflows the argument limit on
  // a 1 MB browser screenshot.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoaFn(binary);
}

/** Standard or url-safe base64 → bytes. */
export function base64ToBytes(encoded: string): Uint8Array {
  const atobFn = nativeAtob();
  // `atob` rejects the url-safe alphabet and unpadded input; normalise first
  // so both spellings decode the same way on every host.
  const normalised = encoded.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  if (!atobFn) return decodeBase64Pure(normalised);
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  let binary: string;
  try {
    binary = atobFn(padded);
  } catch {
    // Some hosts' `atob` are stricter than the spec; the pure path reports a
    // precise error instead of a DOMException.
    return decodeBase64Pure(normalised);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** UTF-8 string → base64. Safe for any Unicode input. */
export function stringToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

/** base64 → UTF-8 string. */
export function base64ToString(encoded: string): string {
  return utf8Decode(base64ToBytes(encoded));
}

/**
 * Bytes → UTF-8 string. `TextDecoder` where the host has one; a pure
 * decoder otherwise, because the terminal bridge's keystrokes go through
 * here and a missing global on some Hermes builds must not turn every
 * accented or CJK character into mojibake by the time it reaches the shell.
 */
export function utf8Decode(bytes: Uint8Array): string {
  const Decoder = (globalThis as { TextDecoder?: new () => { decode(input: Uint8Array): string } }).TextDecoder;
  if (typeof Decoder === 'function') return new Decoder().decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i]!;
    let cp: number;
    let extra: number;
    if (b0 < 0x80) {
      cp = b0;
      extra = 0;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      extra = 1;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      extra = 2;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07;
      extra = 3;
    } else {
      out += '�';
      i += 1;
      continue;
    }
    let valid = true;
    for (let k = 1; k <= extra; k += 1) {
      const bk = bytes[i + k];
      if (bk === undefined || (bk & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      cp = (cp << 6) | (bk & 0x3f);
    }
    if (!valid) {
      out += '�';
      i += 1;
      continue;
    }
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

/** Bytes → base64url without padding (JWS / JWK component form). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

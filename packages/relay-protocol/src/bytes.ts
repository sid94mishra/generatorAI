// ────────────────────────────────────────────────────────────────
// Isomorphic byte / base64url helpers.
//
// Runs unchanged in Node, the browser and React Native, so the pairing offer
// and E2EE handshake have exactly one implementation across every client.
// ────────────────────────────────────────────────────────────────

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, false);
  return bytes;
}

export function writeUint64(target: Uint8Array, offset: number, value: bigint): void {
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    target[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

/** Constant-time byte comparison. */
export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function encodeWithAlphabet(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) {
      if (pad) out += '==';
      break;
    }
    out += alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) {
      if (pad) out += '=';
      break;
    }
    out += alphabet[b2 & 0x3f];
  }
  return out;
}

function decodeWithAlphabet(text: string, alphabet: string): Uint8Array | null {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) return null;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (value >> bits) & 0xff;
      index += 1;
    }
  }
  return out.subarray(0, index);
}

export function toBase64Url(bytes: Uint8Array): string {
  return encodeWithAlphabet(bytes, B64URL_ALPHABET, false);
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  return decodeWithAlphabet(text, B64URL_ALPHABET);
}

export function toBase64(bytes: Uint8Array): string {
  return encodeWithAlphabet(bytes, B64_ALPHABET, true);
}

export function fromBase64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  return decodeWithAlphabet(text, B64_ALPHABET);
}

/**
 * Decodes base64url and enforces both an exact byte length and canonical
 * encoding — re-encoding must reproduce the input byte-for-byte, so two
 * different spellings of the same key cannot produce two different identities.
 */
export function decodeCanonicalBase64Url(value: unknown, length: number): Uint8Array | null {
  if (typeof value !== 'string') return null;
  const bytes = fromBase64Url(value);
  if (!bytes || bytes.length !== length) return null;
  return toBase64Url(bytes) === value ? bytes : null;
}

export function decodeCanonicalBase64(value: unknown, length: number): Uint8Array | null {
  if (typeof value !== 'string') return null;
  const bytes = fromBase64(value);
  if (!bytes || bytes.length !== length) return null;
  return toBase64(bytes) === value ? bytes : null;
}

/** Cross-runtime CSPRNG. */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  // Structurally typed rather than `Crypto` so this file compiles without the
  // DOM lib (Node server) and in the browser/React Native clients alike.
  const cryptoObj = (globalThis as {
    crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  }).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error('No cryptographically secure RNG is available in this runtime');
  }
  cryptoObj.getRandomValues(out);
  return out;
}

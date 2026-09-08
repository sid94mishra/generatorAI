import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  base64ToString,
  bytesToBase64,
  bytesToBase64Url,
  decodeBase64Pure,
  encodeBase64Pure,
  stringToBase64,
} from '../lib/base64';

const VECTORS: ReadonlyArray<[string, string]> = [
  ['', ''],
  ['f', 'Zg=='],
  ['fo', 'Zm8='],
  ['foo', 'Zm9v'],
  ['foob', 'Zm9vYg=='],
  ['fooba', 'Zm9vYmE='],
  ['foobar', 'Zm9vYmFy'],
];

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('base64 — RFC 4648 vectors', () => {
  for (const [plain, encoded] of VECTORS) {
    it(`encodes "${plain}"`, () => {
      const input = new TextEncoder().encode(plain);
      expect(bytesToBase64(input)).toBe(encoded);
      expect(encodeBase64Pure(input)).toBe(encoded);
    });
    it(`decodes "${encoded}"`, () => {
      expect(new TextDecoder().decode(base64ToBytes(encoded))).toBe(plain);
      expect(new TextDecoder().decode(decodeBase64Pure(encoded))).toBe(plain);
    });
  }
});

describe('base64 — pure and native paths agree', () => {
  it('on every byte value, at every length mod 3', () => {
    for (let length = 0; length < 40; length += 1) {
      const input = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) input[i] = (i * 37 + length * 11) & 0xff;
      const pure = encodeBase64Pure(input);
      expect(bytesToBase64(input)).toBe(pure);
      expect(decodeBase64Pure(pure)).toEqual(input);
      expect(base64ToBytes(pure)).toEqual(input);
    }
  });

  it('round-trips a 64-byte signature and bytes ≥ 0x80', () => {
    const sig = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) sig[i] = 0xff - i;
    expect(base64ToBytes(bytesToBase64(sig))).toEqual(sig);
    expect(decodeBase64Pure(encodeBase64Pure(sig))).toEqual(sig);
  });

  it('handles a large buffer without blowing the call stack', () => {
    const big = new Uint8Array(300_000);
    for (let i = 0; i < big.length; i += 1) big[i] = i & 0xff;
    const encoded = bytesToBase64(big);
    expect(encoded.length).toBe(400_000);
    expect(base64ToBytes(encoded)).toEqual(big);
  });
});

describe('base64 — UTF-8 strings', () => {
  it('encodes non-Latin-1 text instead of throwing', () => {
    const text = 'naïve café — 日本語 🚀';
    const encoded = stringToBase64(text);
    expect(base64ToString(encoded)).toBe(text);
  });

  it('matches the pure encoder for multibyte input', () => {
    const text = 'ünïcödé';
    expect(stringToBase64(text)).toBe(encodeBase64Pure(new TextEncoder().encode(text)));
  });
});

describe('base64 — url-safe input', () => {
  it('decodes base64url without padding (JWT segment form)', () => {
    const input = bytes(0xfb, 0xff, 0xbf, 0x00, 0x3e, 0x3f);
    const url = bytesToBase64Url(input);
    expect(url).not.toMatch(/[+/=]/);
    expect(base64ToBytes(url)).toEqual(input);
    expect(decodeBase64Pure(url)).toEqual(input);
  });

  it('strips padding from the url form', () => {
    expect(bytesToBase64Url(bytes(1))).toBe('AQ');
    expect(bytesToBase64Url(bytes(1, 2))).toBe('AQI');
    expect(bytesToBase64Url(bytes(1, 2, 3))).toBe('AQID');
  });

  it('tolerates whitespace and rejects garbage', () => {
    expect(decodeBase64Pure('Zm9v\nYmFy')).toEqual(new TextEncoder().encode('foobar'));
    expect(() => decodeBase64Pure('Zm9v*')).toThrow(/Invalid base64/);
  });
});

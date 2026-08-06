import { describe, expect, it } from 'vitest';
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  formatPairingCode,
  generatePairingCode,
  isPairingCode,
  normalizePairingCode,
} from '../pairingCode.js';

describe('pairing code alphabet', () => {
  it('drops the letters that would make a digit ambiguous', () => {
    // Excluding the LETTERS is the whole trick: with O, I, L and U gone, a
    // `0` can only be a zero and a `1` can only be a one.
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(PAIRING_CODE_ALPHABET).not.toContain(excluded);
    }
  });

  it('has no duplicate symbols, so every draw is equally likely', () => {
    expect(new Set(PAIRING_CODE_ALPHABET).size).toBe(PAIRING_CODE_ALPHABET.length);
  });
});

describe('generatePairingCode', () => {
  it('produces a canonical code of the declared length', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generatePairingCode();
      expect(code).toHaveLength(PAIRING_CODE_LENGTH);
      expect(isPairingCode(code)).toBe(true);
    }
  });

  it('only ever emits alphabet members', () => {
    for (let i = 0; i < 200; i += 1) {
      for (const char of generatePairingCode()) {
        expect(PAIRING_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generatePairingCode());
    expect(seen.size).toBe(500);
  });

  it('draws roughly uniformly across the alphabet', () => {
    // Guards the rejection sampling: a modulo bug would starve the tail of the
    // alphabet. 4000 codes give ~1500 draws per symbol, so a 3x margin is a
    // very loose bound that still catches real skew.
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i += 1) {
      for (const char of generatePairingCode()) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(PAIRING_CODE_ALPHABET.length);
    const expected = (4000 * PAIRING_CODE_LENGTH) / PAIRING_CODE_ALPHABET.length;
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected / 3);
      expect(count).toBeLessThan(expected * 3);
    }
  });
});

describe('normalizePairingCode', () => {
  it('accepts the exact string we render on the host', () => {
    const code = generatePairingCode();
    expect(normalizePairingCode(formatPairingCode(code))).toBe(code);
  });

  it('is case-insensitive, so phone autocapitalisation cannot break pairing', () => {
    expect(normalizePairingCode('4h7k2m9pxq3t')).toBe('4H7K2M9PXQ3T');
  });

  it('ignores the separators and whitespace a user may type or paste', () => {
    expect(normalizePairingCode('4H7K-2M9P-XQ3T')).toBe('4H7K2M9PXQ3T');
    expect(normalizePairingCode('  4H7K 2M9P\tXQ3T \n')).toBe('4H7K2M9PXQ3T');
  });

  it('resolves the excluded letters onto the digit they can only have meant', () => {
    // Deterministic, not a guess: O/I/L/U never occur in a generated code, so
    // each can only be a transcription of the glyph it resembles.
    expect(normalizePairingCode('O123')).toBe('0123');
    expect(normalizePairingCode('I23I')).toBe('1231');
    expect(normalizePairingCode('L23L')).toBe('1231');
    expect(normalizePairingCode('U')).toBe('V');
  });

  it('still round-trips a real generated code after alias folding', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generatePairingCode();
      expect(normalizePairingCode(code)).toBe(code);
    }
  });

  it('rejects codes of the wrong length', () => {
    expect(isPairingCode('4H7K-2M9P')).toBe(false);
    expect(isPairingCode('4H7K-2M9P-XQ3T-9999')).toBe(false);
    expect(isPairingCode('')).toBe(false);
  });
});

describe('formatPairingCode', () => {
  it('groups into readable blocks without changing the secret', () => {
    expect(formatPairingCode('4H7K2M9PXQ3T')).toBe('4H7K-2M9P-XQ3T');
  });

  it('is idempotent, so re-formatting a displayed code is safe', () => {
    const once = formatPairingCode('4H7K2M9PXQ3T');
    expect(formatPairingCode(once)).toBe(once);
  });
});

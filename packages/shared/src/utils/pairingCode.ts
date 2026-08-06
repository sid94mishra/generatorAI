// ────────────────────────────────────────────────────────────────
// Human-typeable pairing codes
// ────────────────────────────────────────────────────────────────
//
// A pairing grant used to be a 43-character base64url secret embedded in a
// multi-kilobyte offer blob. That is fine for a QR code and hostile for the
// case people actually hit: "I'm on my laptop, the app is on my desktop, read
// me the code". This module defines the short code that replaces it.
//
// Design constraints:
//   - Typeable and speakable: no character pair a human confuses when reading
//     a code aloud or retyping it from another screen.
//   - Case-insensitive on input, canonical uppercase on the wire, so a phone
//     keyboard's autocapitalisation can't cause a spurious failure.
//   - Uniformly random, with enough entropy that online guessing is hopeless
//     against the server's existing defences (10 minute TTL, 5 attempts per
//     grant, 10/min per source and 60/min global throttles).
//
// This module lives in `@generatorai/shared` because BOTH sides need the exact
// same rules: `@generatorai/auth` mints codes with it, and the web pairing
// screen normalises typed input with it. Duplicating the alphabet in two
// packages would let them drift, and a drifted alphabet is a silent
// "invalid code" bug that only reproduces for whichever character diverged.

/**
 * Crockford base32: the ten digits plus A-Z with `I`, `L`, `O` and `U`
 * removed.
 *
 * Excluding the LETTERS rather than the digits is what makes this alphabet
 * good for typed codes. Because `O` is not a member, a `0` on screen can only
 * be a zero; because `I` and `L` are not members, a `1` can only be a one. The
 * ambiguity is resolved by construction, so {@link normalizePairingCode} can
 * fold a mistyped `O` onto `0` deterministically instead of guessing.
 *
 * `U` is dropped as well, which keeps a randomly generated code from spelling
 * something we would rather not ask a user to read out loud.
 *
 * Length is exactly 32, which matters for the sampling in
 * {@link generatePairingCode}.
 */
export const PAIRING_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * The excluded letters, each mapped to the single alphabet member it can
 * possibly have meant. These are not heuristics: since `O`, `I`, `L` and `U`
 * never appear in a generated code, encountering one can only be a
 * transcription of the glyph it resembles.
 */
const CONFUSABLE_ALIASES: Readonly<Record<string, string>> = {
  O: '0',
  I: '1',
  L: '1',
  U: 'V',
};

/** Characters per code. 12 × log2(32) = 60 bits of entropy. */
export const PAIRING_CODE_LENGTH = 12;

/** Characters per display group, e.g. `4H7K-2M9P-XQ3T`. */
export const PAIRING_CODE_GROUP_SIZE = 4;

/**
 * Strips formatting, folds case, and resolves the confusable letters, so
 * `4h7k-2m9p xq3t` and `4H7K2M9PXQ3T` reach the same code. Does NOT validate
 * length — call {@link isPairingCode} for that.
 *
 * Characters outside the alphabet are removed rather than rejected, because
 * the dashes we render for readability, and any spaces a user's keyboard
 * inserts, would otherwise have to be deleted by hand.
 */
export function normalizePairingCode(input: string): string {
  let normalized = '';
  for (const char of input.toUpperCase()) {
    const resolved = CONFUSABLE_ALIASES[char] ?? char;
    if (PAIRING_CODE_ALPHABET.includes(resolved)) {
      normalized += resolved;
    }
  }
  return normalized;
}

/** True when `input` normalises to a well-formed code. */
export function isPairingCode(input: string): boolean {
  return normalizePairingCode(input).length === PAIRING_CODE_LENGTH;
}

/**
 * Renders a canonical code in dash-separated groups for display. Grouping is
 * presentation only — the wire format is always the ungrouped canonical form,
 * because a server that accepted both would have to normalise before hashing
 * and that is an easy place to introduce a lookup mismatch.
 */
export function formatPairingCode(code: string): string {
  const canonical = normalizePairingCode(code);
  const groups: string[] = [];
  for (let i = 0; i < canonical.length; i += PAIRING_CODE_GROUP_SIZE) {
    groups.push(canonical.slice(i, i + PAIRING_CODE_GROUP_SIZE));
  }
  return groups.join('-');
}

/**
 * Generates a uniformly random pairing code.
 *
 * Uses `globalThis.crypto.getRandomValues` (present in Node 19+ and every
 * supported browser) so this module stays isomorphic and does not drag
 * `node:crypto` into the web bundle.
 *
 * Sampling is rejection-based rather than `byte % 32`. With a 32-character
 * alphabet the modulo happens to be unbiased, but that is a property of the
 * current length, not of the code — a later edit to the alphabet would silently
 * introduce modulo bias. Rejection sampling stays correct for any length.
 */
export function generatePairingCode(): string {
  const alphabetLength = PAIRING_CODE_ALPHABET.length;
  const ceiling = Math.floor(256 / alphabetLength) * alphabetLength;
  let code = '';

  while (code.length < PAIRING_CODE_LENGTH) {
    const draw = new Uint8Array(PAIRING_CODE_LENGTH);
    globalThis.crypto.getRandomValues(draw);
    for (const byte of draw) {
      if (byte >= ceiling) {
        continue; // discard the biased tail of the byte range
      }
      code += PAIRING_CODE_ALPHABET[byte % alphabetLength];
      if (code.length === PAIRING_CODE_LENGTH) {
        break;
      }
    }
  }

  return code;
}

// ────────────────────────────────────────────────────────────────
// SentenceBoundaryBuffer — deterministic; every case is a direct
// input/output assertion.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { SentenceBoundaryBuffer } from '../SentenceBoundaryBuffer.js';

describe('SentenceBoundaryBuffer', () => {
  it('emits nothing until a sentence-ending mark followed by whitespace arrives', () => {
    const buf = new SentenceBoundaryBuffer();
    expect(buf.push('Hello there')).toEqual([]);
    expect(buf.push(', how are you')).toEqual([]);
  });

  it('emits exactly one sentence once a period+space completes it', () => {
    const buf = new SentenceBoundaryBuffer();
    buf.push('Hello there');
    expect(buf.push('. How are you?')).toEqual(['Hello there.']);
  });

  it('splits multiple complete sentences delivered in one push', () => {
    const buf = new SentenceBoundaryBuffer();
    // "One." and "Two." are already followed by whitespace within this
    // single push, so both emit immediately; "Three." has no trailing
    // whitespace yet and stays buffered.
    expect(buf.push('One. Two. Three.')).toEqual(['One.', 'Two.']);
    expect(buf.push(' ')).toEqual(['Three.']);
  });

  it('handles a token-by-token stream (simulating an LLM emitting one token at a time)', () => {
    const buf = new SentenceBoundaryBuffer();
    const tokens = ['Hel', 'lo ', 'wor', 'ld', '. ', 'By', 'e.'];
    const all: string[] = [];
    for (const t of tokens) all.push(...buf.push(t));
    expect(all).toEqual(['Hello world.']);
    expect(buf.flush()).toBe('Bye.');
  });

  it('recognizes ! and ? as sentence terminators', () => {
    const buf = new SentenceBoundaryBuffer();
    expect(buf.push('Watch out! Really? ')).toEqual(['Watch out!', 'Really?']);
  });

  it('treats a run of terminators ("...", "?!") as one boundary', () => {
    const buf = new SentenceBoundaryBuffer();
    expect(buf.push('Wait... really?! Yes.')).toEqual(['Wait...', 'really?!']);
  });

  it('flush() returns and clears whatever is left, trimmed', () => {
    const buf = new SentenceBoundaryBuffer();
    buf.push('trailing thought with no terminator  ');
    expect(buf.flush()).toBe('trailing thought with no terminator');
    expect(buf.flush()).toBe(''); // idempotent — nothing left the second time
  });

  it('flush() after a complete sentence was already emitted returns only the remainder', () => {
    const buf = new SentenceBoundaryBuffer();
    expect(buf.push('Done. And then')).toEqual(['Done.']);
    expect(buf.flush()).toBe('And then');
  });

  it('an empty push contributes nothing and does not crash', () => {
    const buf = new SentenceBoundaryBuffer();
    expect(buf.push('')).toEqual([]);
    expect(buf.flush()).toBe('');
  });

  // Phase 3+4 review finding: a delta that happens to land as JUST
  // punctuation+whitespace (e.g. ".!? ") matched SENTENCE_END and, after
  // trim(), was a non-empty string — so it got forwarded to the TTS engine
  // as if it were a real sentence.
  it('does not emit a punctuation-only fragment as if it were a real sentence', () => {
    const buf = new SentenceBoundaryBuffer();
    expect(buf.push('...! ')).toEqual([]);
    expect(buf.push('Hello. ')).toEqual(['Hello.']);
  });

  it('flush() does not return a punctuation-only remainder as if it were real text', () => {
    const buf = new SentenceBoundaryBuffer();
    buf.push('...!');
    expect(buf.flush()).toBe('');
  });

  // Phase 3+4 review finding: text with no . / ! / ? for a long stretch (a
  // code block, a bullet list) accumulated in `buffer` with no bound,
  // defeating the entire point of Phase 4 pipelining — sentence 1's audio
  // couldn't start until the whole un-punctuated message finally flushed.
  it('forces a boundary once unterminated text exceeds the cap, instead of buffering it all forever', () => {
    const buf = new SentenceBoundaryBuffer();
    const longText = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' '); // no . ! ? anywhere

    const emitted = buf.push(longText);

    expect(emitted.length).toBeGreaterThan(0); // pipelining actually happened before the stream ended
    for (const piece of emitted) {
      expect(piece.length).toBeLessThanOrEqual(400);
      expect(piece).not.toBe(''); // never a forced empty/whitespace-only piece
    }
    // Nothing is lost or duplicated — reassembling every forced piece plus
    // whatever's left recovers the exact original text.
    const reassembled = [...emitted, buf.flush()].join(' ');
    expect(reassembled).toBe(longText);
  });

  it('a single unbroken token far longer than the cap hard-cuts at the cap rather than buffering it all forever', () => {
    const buf = new SentenceBoundaryBuffer();
    const oneGiantWord = 'x'.repeat(500); // no whitespace anywhere to break at
    const emitted = buf.push(oneGiantWord);
    // No space to break at, so the fallback is a hard cut exactly at the cap.
    expect(emitted).toEqual(['x'.repeat(400)]);
    expect(buf.flush()).toBe('x'.repeat(100));
  });
});

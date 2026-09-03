// ────────────────────────────────────────────────────────────────
// insertAtCaret — Phase 1 voice-input insert-at-caret semantics
// (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C.2). Pure function, so
// every case is a direct input/output assertion — no component mount, no
// DOM, no mocked audio/WebSocket stack needed.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { insertTextAtCaret, CaretInsertionSequencer } from '@generatorai/shared';

describe('insertTextAtCaret', () => {
  it('inserts into an empty textarea with no stray leading/trailing space', () => {
    const result = insertTextAtCaret('', 0, 0, 'hello world');
    expect(result).toEqual({ text: 'hello world', caret: 11 });
  });

  it('inserts at the end of existing text with a separating space', () => {
    const result = insertTextAtCaret('Hello', 5, 5, 'world');
    expect(result).toEqual({ text: 'Hello world', caret: 11 });
  });

  it('does not double a space that is already there', () => {
    const result = insertTextAtCaret('Hello ', 6, 6, 'world');
    expect(result).toEqual({ text: 'Hello world', caret: 11 });
  });

  it('inserts in the MIDDLE of existing text at the caret, not appended to the end', () => {
    // "Hello |world" (caret between "Hello " and "world")
    const value = 'Hello world';
    const caret = 6;
    const result = insertTextAtCaret(value, caret, caret, 'there');
    expect(result).toEqual({ text: 'Hello there world', caret: 11 });
  });

  it('adds a space before AND after when inserting between two non-space characters', () => {
    const value = 'AB';
    const result = insertTextAtCaret(value, 1, 1, 'mid');
    expect(result).toEqual({ text: 'A mid B', caret: 5 });
  });

  it('replaces a selected range (selectionStart !== selectionEnd) rather than inserting alongside it', () => {
    // "Hello [world]!" -> select "world", dictate "there"
    const value = 'Hello world!';
    const result = insertTextAtCaret(value, 6, 11, 'there');
    expect(result).toEqual({ text: 'Hello there!', caret: 11 });
  });

  it('does not add a trailing space before common closing punctuation', () => {
    expect(insertTextAtCaret('Hello world?', 6, 11, 'there')).toEqual({ text: 'Hello there?', caret: 11 });
    expect(insertTextAtCaret('Hello world,', 6, 11, 'there')).toEqual({ text: 'Hello there,', caret: 11 });
    expect(insertTextAtCaret('(Hello world)', 7, 12, 'there')).toEqual({ text: '(Hello there)', caret: 12 });
  });

  it('trims the inserted text itself (no leading/trailing whitespace from the transcript)', () => {
    const result = insertTextAtCaret('Hello', 5, 5, '  world  ');
    expect(result).toEqual({ text: 'Hello world', caret: 11 });
  });

  it('returns null for empty input — caller must treat this as a no-op', () => {
    expect(insertTextAtCaret('Hello', 5, 5, '')).toBeNull();
    expect(insertTextAtCaret('Hello', 5, 5, '   ')).toBeNull();
  });

  it('does not add a leading space when inserting at the very start of non-empty text', () => {
    const result = insertTextAtCaret('world', 0, 0, 'hello');
    expect(result).toEqual({ text: 'hello world', caret: 5 });
  });

  it('does not add a trailing space when inserting at the very end with nothing after', () => {
    const result = insertTextAtCaret('', 0, 0, 'hello');
    expect(result?.text.endsWith(' ')).toBe(false);
  });

  it('handles a newline already present as "whitespace" — no extra space added next to it', () => {
    const value = 'Hello\nworld';
    // Caret right after the newline, before "world".
    const result = insertTextAtCaret(value, 6, 6, 'there');
    // Caret lands right after "there" (11), not after the trailing space
    // inserted before "world" — matches the function's documented contract.
    expect(result).toEqual({ text: 'Hello\nthere world', caret: 11 });
  });
});

describe('CaretInsertionSequencer', () => {
  it('a single insertion behaves exactly like the plain function', () => {
    const seq = new CaretInsertionSequencer();
    const result = seq.insert('Hello world', 6, 6, 'there');
    expect(result).toEqual({ text: 'Hello there world', caret: 11 });
  });

  it('REGRESSION — two insertions back-to-back (before consumePending() is ever called) compose in ORDER, not reversed', () => {
    // Reproduces the exact adversarial-review finding: "Hello world" with
    // the caret at 6 ("Hello |world"), dictate "XXX" then "YYY" before the
    // textarea has repainted between them. Without the sequencer (reading
    // the live DOM selection for both), the second insertion computes
    // against the STALE pre-first-insertion text/selection, producing
    // "Hello YYY XXX world" — spoken order reversed.
    const seq = new CaretInsertionSequencer();
    const value0 = 'Hello world';

    const r1 = seq.insert(value0, 6, 6, 'XXX');
    expect(r1).toEqual({ text: 'Hello XXX world', caret: 9 });

    // The second call passes the SAME (still-stale) DOM selection (6,6) —
    // exactly what would happen if the textarea hasn't repainted yet — but
    // the sequencer must use its own pending logical position instead.
    const r2 = seq.insert(r1!.text, 6, 6, 'YYY');
    expect(r2).toEqual({ text: 'Hello XXX YYY world', caret: 13 });
  });

  it('three rapid insertions still compose in order', () => {
    const seq = new CaretInsertionSequencer();
    let value = '';
    for (const word of ['one', 'two', 'three']) {
      // Every call passes the ORIGINAL (never-updated) selection — as if
      // the DOM never repainted between any of them.
      const result = seq.insert(value, 0, 0, word);
      value = result!.text;
    }
    expect(value).toBe('one two three');
  });

  it('consumePending() returns the pending caret once, then null — idempotent across multiple rAF callbacks', () => {
    const seq = new CaretInsertionSequencer();
    seq.insert('', 0, 0, 'hello');
    expect(seq.consumePending()).toBe(5);
    expect(seq.consumePending()).toBeNull();
  });

  it('after consumePending(), the NEXT insertion falls back to the live DOM selection again (normal, non-racing case)', () => {
    const seq = new CaretInsertionSequencer();
    seq.insert('world', 0, 0, 'hello'); // -> "hello world", pending caret = 5
    seq.consumePending(); // simulates the rAF having applied it to the real DOM

    // User has since clicked elsewhere — new live selection is now at the end (11).
    const result = seq.insert('hello world', 11, 11, 'again');
    expect(result).toEqual({ text: 'hello world again', caret: 17 });
  });

  it('clearPending() discards a stale pending position — a late insertion falls back to the fresh DOM selection', () => {
    const seq = new CaretInsertionSequencer();
    seq.insert('world', 0, 0, 'hello'); // pending caret = 5, DOM not yet updated

    // User manually clicks elsewhere before the pending insertion's rAF fires.
    seq.clearPending();

    // A late/stray insertion (e.g. a segment event delayed by network
    // latency) must use the CURRENT selection, not the abandoned pending one.
    const result = seq.insert('hello world', 11, 11, 'late');
    expect(result).toEqual({ text: 'hello world late', caret: 16 });
  });

  it('a null result (empty insert text) never sets a pending caret', () => {
    const seq = new CaretInsertionSequencer();
    const result = seq.insert('Hello', 5, 5, '   ');
    expect(result).toBeNull();
    expect(seq.consumePending()).toBeNull();
  });
});

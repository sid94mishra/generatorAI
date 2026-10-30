import { describe, expect, it } from 'vitest';

import {
  WAVEFORM_BARS,
  WAVEFORM_WEIGHTS,
  commitDictation,
  committedRangeIntact,
  formatElapsed,
  type DictationState,
} from '../dictationCommit';

const fresh = (draft = '', caret = draft.length): DictationState => ({
  draft,
  caret,
  lastCommitted: null,
});

describe('commitDictation — stitching', () => {
  it('inserts at the caret with a separator and sentence case', () => {
    const r = commitDictation(fresh('Fix the bug', 11), 'in the login form.');
    expect(r.draft).toBe('Fix the bug in the login form.');
    expect(r.caret).toBe(r.draft.length);
    expect(r.lastCommitted).toEqual({ start: 12, end: 30, text: 'in the login form.' });
  });

  it('capitalises a new sentence after a period', () => {
    const r = commitDictation(fresh('Done.'), 'now test it');
    expect(r.draft).toBe('Done. Now test it');
  });

  it('inserts mid-text and keeps the tail', () => {
    const r = commitDictation(fresh('Hello world', 5), 'there');
    expect(r.draft).toBe('Hello there world');
    expect(r.caret).toBe(11);
  });

  it('attaches to a path without a space', () => {
    const r = commitDictation(fresh('open src/'), 'server');
    expect(r.draft).toBe('open src/server');
  });
});

describe('commitDictation — "scratch that"', () => {
  it('retracts the previous utterance and puts the remainder in its place', () => {
    const first = commitDictation(fresh(''), 'send the report');
    const second = commitDictation(
      { draft: first.draft, caret: first.caret, lastCommitted: first.lastCommitted },
      'scratch that send the summary',
    );
    expect(second.retracted).toBe(true);
    expect(second.draft).toBe('Send the summary');
    expect(second.lastCommitted?.text).toBe('Send the summary');
  });

  it('a bare "scratch that" removes the previous utterance and nothing else', () => {
    const first = commitDictation(fresh('Prefix.'), 'wrong words');
    expect(first.draft).toBe('Prefix. Wrong words');
    const second = commitDictation(
      { draft: first.draft, caret: first.caret, lastCommitted: first.lastCommitted },
      'Scratch that.',
    );
    expect(second.retracted).toBe(true);
    expect(second.draft).toBe('Prefix.');
    expect(second.caret).toBe(7);
    expect(second.lastCommitted).toBeNull();
  });

  it('never retracts text the user has edited since', () => {
    const first = commitDictation(fresh(''), 'keep this');
    // The user typed into the committed span.
    const edited = first.draft.replace('this', 'THIS');
    const second = commitDictation(
      { draft: edited, caret: edited.length, lastCommitted: first.lastCommitted },
      'scratch that and add more',
    );
    expect(second.retracted).toBe(false);
    expect(second.draft).toBe('Keep THIS and add more');
  });

  it('with no previous utterance, the words after the command are simply inserted', () => {
    const r = commitDictation(fresh('Note:'), 'scratch that hello');
    expect(r.retracted).toBe(false);
    expect(r.draft).toBe('Note: hello');
  });

  it('a bare "scratch that" with nothing to retract leaves the draft alone', () => {
    const r = commitDictation(fresh('Untouched', 3), 'scratch that');
    expect(r.draft).toBe('Untouched');
    expect(r.caret).toBe(3);
  });

  it('committedRangeIntact rejects ranges past the end or with changed text', () => {
    expect(committedRangeIntact('abc', { start: 0, end: 5, text: 'abcde' })).toBe(false);
    expect(committedRangeIntact('abc', { start: 0, end: 3, text: 'abc' })).toBe(true);
    expect(committedRangeIntact('abc', { start: 0, end: 3, text: 'abd' })).toBe(false);
    expect(committedRangeIntact('abc', null)).toBe(false);
  });
});

describe('pill helpers', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(42_000)).toBe('0:42');
    expect(formatElapsed(125_500)).toBe('2:05');
    expect(formatElapsed(-5)).toBe('0:00');
  });

  it('has 18 bell-shaped weights, tallest in the middle', () => {
    expect(WAVEFORM_BARS).toBe(18);
    expect(WAVEFORM_WEIGHTS).toHaveLength(18);
    const mid = Math.max(...WAVEFORM_WEIGHTS);
    expect(WAVEFORM_WEIGHTS[8]).toBeCloseTo(mid, 1);
    expect(WAVEFORM_WEIGHTS[0]!).toBeLessThan(WAVEFORM_WEIGHTS[8]!);
    expect(WAVEFORM_WEIGHTS.every((w) => w >= 0.35 && w <= 1)).toBe(true);
  });
});

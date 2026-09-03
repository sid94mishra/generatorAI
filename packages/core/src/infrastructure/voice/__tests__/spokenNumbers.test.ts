// ────────────────────────────────────────────────────────────────
// spokenNumbers — the ITN stage the shipped NeMo-Speech.cpp binary does not
// carry (`nemo-speech doctor` lists no `norm` feature).
//
// The cases below are taken from a real dictation session, where every number
// arrived as words: "one zero zero two", "one thousand two hundred and thirty
// four", "forty five. Fifty six. Thirty one point eight".
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { normalizeSpokenNumbers as n } from '../spokenNumbers.js';

describe('spoken numbers → digits', () => {
  it('folds an arithmetic compound into one value', () => {
    expect(n('one thousand two hundred and thirty four')).toBe('1234');
    expect(n('twenty three')).toBe('23');
    expect(n('two hundred')).toBe('200');
    expect(n('forty five')).toBe('45');
    expect(n('nineteen')).toBe('19');
  });

  it('keeps separate numbers separate', () => {
    // The trap: "ten eleven" is not a number you can say. Greedily gluing
    // adjacent numerals would silently produce 10111213 here.
    expect(n('ten eleven twelve thirteen')).toBe('10 11 12 13');
    expect(n('forty five. Fifty six.')).toBe('45. 56.');
  });

  it('reads a run of bare digits as a sequence', () => {
    expect(n('one zero zero two')).toBe('1002');
    expect(n('number one zero zero two')).toBe('number 1002');
    expect(n('zero one zero two')).toBe('0102');
  });

  it('does not treat two digits as a sequence', () => {
    // "two three" is as likely two quantities as the number 23; refuse to guess.
    // Both are lone small numerals with no counting cue, so both stay words.
    expect(n('two three')).toBe('two three');
    expect(n('item two three')).toBe('item 2 three');
  });

  it('leaves a lone small number spelled out unless something marks it as a label', () => {
    // Converting every numeral produced "1 thing" and "a trial period of 3
    // months" — worse than the problem it solved.
    expect(n('one thing')).toBe('one thing');
    expect(n('a trial period of three months')).toBe('a trial period of three months');
    expect(n('line one')).toBe('line one');
    // …but a counting cue makes it an identifier, which is how the reference
    // dictation used it throughout.
    expect(n('point number one')).toBe('point number 1');
    expect(n('issue three')).toBe('issue 3');
    expect(n('step four')).toBe('step 4');
  });

  it('still converts a lone number at or above ten', () => {
    expect(n('ten')).toBe('10');
    expect(n('I have fifteen of them')).toBe('I have 15 of them');
  });

  it('handles a decimal only between numbers', () => {
    expect(n('thirty one point eight')).toBe('31.8');
    expect(n('three point one four')).toBe('3.14');
    // "point" as an ordinary noun must survive — this exact phrase appeared
    // throughout the reference dictation.
    expect(n('point number one')).toBe('point number 1');
    expect(n('point number twenty one')).toBe('point number 21');
  });

  it('preserves surrounding punctuation and spacing', () => {
    expect(n('issue number fifteen, and twenty three.')).toBe('issue number 15, and 23.');
    expect(n('  spaced   out  fifteen  ')).toBe('  spaced   out  15  ');
  });

  it('leaves ordinals and non-numbers alone', () => {
    expect(n('the first point and the second one')).toBe('the first point and the second one');
    expect(n('nothing numeric here')).toBe('nothing numeric here');
  });

  it('is idempotent, because it runs on every streaming partial', () => {
    const once = n('one thousand two hundred and thirty four and twenty three');
    expect(n(once)).toBe(once);
  });

  it('does not glue a year-shaped pair into one number', () => {
    // "nineteen eighty" is read as digits by people, not summed to 99.
    expect(n('nineteen eighty')).toBe('19 80');
  });

  it('handles a scale phrase with a trailing connector', () => {
    expect(n('two thousand and five')).toBe('2005');
    expect(n('one hundred and one')).toBe('101');
  });
});

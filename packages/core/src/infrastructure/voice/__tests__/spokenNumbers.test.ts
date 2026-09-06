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

  it('reads a year-shaped pair as a year, never as a sum', () => {
    // "nineteen eighty" is read in pairs by people — 1980 — never summed to 99.
    expect(n('nineteen eighty')).toBe('1980');
    expect(n('nineteen eighty four')).toBe('1984');
    expect(n('in twenty twenty six we shipped it')).toBe('in 2026 we shipped it');
    expect(n('twenty oh six')).toBe('2006');
    expect(n('nineteen hundred')).toBe('1900');
    // …but a count of separate numbers is still a count.
    expect(n('ten eleven twelve thirteen')).toBe('10 11 12 13');
  });

  it('reads clock times', () => {
    expect(n('meet at ten thirty a m tomorrow')).toBe('meet at 10:30 AM tomorrow');
    expect(n('at eleven fifteen')).toBe('at 11:15');
    expect(n('by two forty five p m')).toBe('by 2:45 PM');
    expect(n('nine o clock')).toBe("9 o'clock");
    expect(n('ten a m')).toBe('10 AM');
  });

  it('groups thousands from five digits up, the way Dragon does', () => {
    expect(n('twelve thousand requests')).toBe('12,000 requests');
    expect(n('one point two million')).toBe('1.2 million');
    expect(n('one thousand two hundred')).toBe('1200');
    // Digit sequences are identifiers, never grouped.
    expect(n('one zero zero two three')).toBe('10023');
  });

  it('reads dotted versions and unit words', () => {
    expect(n('the version is two point three point one')).toBe('the version is 2.3.1');
    expect(n('fifty percent more')).toBe('50% more');
    expect(n('twenty percent sign off')).toBe('20% off');
    expect(n('two hundred and fifty dollars')).toBe('$250');
    expect(n('one hundred percent')).toBe('100%');
  });

  it('forces a digit after "numeral", the universal dictation escape', () => {
    expect(n('numeral three items')).toBe('3 items');
    expect(n('take numeral one')).toBe('take 1');
  });

  it('handles a scale phrase with a trailing connector', () => {
    expect(n('two thousand and five')).toBe('2005');
    expect(n('one hundred and one')).toBe('101');
  });
});

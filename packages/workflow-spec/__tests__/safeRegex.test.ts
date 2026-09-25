import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileSafeRegex } from '../src/index.js';

function re(pattern: string, flags = '') {
  const r = compileSafeRegex(pattern, flags);
  if (!r.ok) throw new Error(`${pattern}: ${r.error.message}`);
  return r.regex;
}

describe('compileSafeRegex: agrees with RegExp', () => {
  const cases: Array<[string, string, string[]]> = [
    ['abc', '', ['abc', 'xabcx', 'ab', '']],
    ['^abc$', '', ['abc', 'abcd', ' abc']],
    ['a.c', '', ['abc', 'a\nc', 'ac']],
    ['a.c', 's', ['a\nc']],
    ['colou?r', '', ['color', 'colour', 'colouur']],
    ['a*b+c?', '', ['b', 'aab', 'c', 'abbc']],
    ['(ab)+$', '', ['ababab', 'aba', '']],
    ['(?:x|y){2,3}z', '', ['xyz', 'xz', 'xyxyz', 'yyyyz']],
    ['a{3}', '', ['aa', 'aaa']],
    ['a{2,}', '', ['a', 'aa', 'aaaa']],
    ['[a-c]+', '', ['xyz', 'cab']],
    ['[^a-c]', '', ['abc', 'abcd']],
    ['[]', '', ['a', '']],
    ['[^]', '', ['a', '']],
    ['\\d{3}-\\d{4}', '', ['555-1234', '55-1234']],
    ['\\w+@\\w+\\.com', '', ['me@x.com', '@x.com']],
    ['\\bcat\\b', '', ['a cat!', 'concat', 'cats']],
    ['\\Bcat', '', ['concat', 'cat']],
    ['\\s+', '', ['a b', 'ab', '\t']],
    ['\\S\\D\\W', '', ['aa!', 'a1!']],
    ['^line$', 'm', ['one\nline\ntwo', 'lines']],
    ['^line$', '', ['one\nline\ntwo']],
    ['HELLO', 'i', ['hello world', 'help']],
    ['[a-z]+', 'i', ['ABC', '123']],
    ['[^a]', 'i', ['A', 'b']],
    ['a|b|', '', ['', 'zz']],
    ['\\x41\\u0042', '', ['AB', 'ab']],
    ['[\\d-z]', '', ['-', '5', 'z', 'y']],
    ['a+?b', '', ['aab']],
    ['x{', '', ['x{', 'x']],
    ['a\\.b', '', ['a.b', 'axb']],
    ['(?<year>\\d{4})', '', ['2026', '99']],
    ['[\\]]', '', [']', 'a']],
    ['\\/path', '', ['/path']],
    ['(a*)*b', '', ['aaab', 'aaa']],
  ];
  it.each(cases)('/%s/%s', (pattern, flags, inputs) => {
    const safe = re(pattern, flags);
    const native = new RegExp(pattern, flags);
    for (const input of inputs) expect(safe.test(input), JSON.stringify(input)).toBe(native.test(input));
  });

  it('matches RegExp on generated patterns and inputs (property)', () => {
    const atom = fc.constantFrom('a', 'b', '.', '[ab]', '[^a]', '\\d', '\\w', '\\s', 'x');
    const piece = fc.tuple(atom, fc.constantFrom('', '*', '+', '?', '{2}', '{1,3}', '{0,}')).map(([a, q]) => a + q);
    const seq = fc.array(piece, { minLength: 1, maxLength: 4 }).map((p) => p.join(''));
    const group = fc.oneof(seq, seq.map((s) => `(${s})*`), fc.tuple(seq, seq).map(([x, y]) => `(?:${x}|${y})`));
    const pattern = fc
      .tuple(fc.constantFrom('', '^'), fc.array(group, { minLength: 1, maxLength: 3 }), fc.constantFrom('', '$'))
      .map(([s, g, e]) => s + g.join('') + e);
    const input = fc.string({ maxLength: 12, unit: fc.constantFrom('a', 'b', 'x', '1', ' ', '\n', 'A') });
    fc.assert(
      fc.property(pattern, input, fc.constantFrom('', 'i', 'm', 's'), (p, s, f) => {
        expect(re(p, f).test(s)).toBe(new RegExp(p, f).test(s));
      }),
      { numRuns: 2000 },
    );
  });
});

describe('compileSafeRegex: linear time', () => {
  it('handles catastrophic-backtracking patterns quickly', () => {
    // Each of these takes exponential time in a backtracking engine on this input.
    const evil = ['(a+)+b', '(a|aa)+b', '(a|a?)+b', '(.*a){20}b', '^(\\w+\\s?)*$'];
    const input = `${'a'.repeat(5000)}!`;
    for (const p of evil) {
      const start = Date.now();
      expect(re(p).test(input), p).toBe(false);
      expect(Date.now() - start, p).toBeLessThan(2000);
    }
  });
});

describe('compileSafeRegex: rejected patterns', () => {
  it.each<[string, string, RegExp]>([
    ['(a)\\1', '', /Backreferences/],
    ['\\k<x>', '', /Backreferences/],
    ['(?=a)', '', /Lookaround/],
    ['(?!a)', '', /Lookaround/],
    ['(?<=a)b', '', /Lookaround/],
    ['(?<!a)b', '', /Lookaround/],
    ['(ab', '', /Unterminated group/],
    ['ab)', '', /Unmatched/],
    ['[ab', '', /Unterminated character class/],
    ['*a', '', /Nothing to repeat/],
    ['a**', '', /Nothing to repeat/],
    ['a{3,2}', '', /out of order/],
    ['a{5000}', '', /limited/],
    ['[z-a]', '', /out of order/],
    ['abc\\', '', /backslash/],
    ['a', 'g', /flags/],
    ['a', 'ii', /flags/],
  ])('/%s/%s', (pattern, flags, message) => {
    const r = compileSafeRegex(pattern, flags);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(message);
  });

  it('caps the NFA size', () => {
    const r = compileSafeRegex('(((a{100}){100}){100})');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/too large/);
  });

  it('never throws on arbitrary patterns', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (p) => {
        const r = compileSafeRegex(p);
        if (r.ok) expect(typeof r.regex.test('abc')).toBe('boolean');
      }),
      { numRuns: 3000 },
    );
  });
});

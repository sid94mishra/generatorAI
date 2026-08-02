import { describe, it, expect } from 'vitest';
import { interpolateVariables } from '../src/utils/index.js';

describe('interpolateVariables', () => {
  it('substitutes a simple placeholder', () => {
    expect(interpolateVariables('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  it('tolerates surrounding whitespace inside the braces', () => {
    // Regression: `{{ topic }}` must resolve identically to `{{topic}}`.
    expect(interpolateVariables('A {{ topic }} B', { topic: 'X' })).toBe('A X B');
  });

  it('is case-sensitive on keys', () => {
    expect(interpolateVariables('{{Topic}}', { topic: 'lower' })).toBe('{{Topic}}');
  });

  it('leaves unresolved placeholders literal and collects their names', () => {
    const unresolved = new Set<string>();
    const out = interpolateVariables('start {{missing}} end', {}, unresolved);
    expect(out).toBe('start {{missing}} end');
    expect([...unresolved]).toEqual(['missing']);
  });

  it('resolves dotted paths', () => {
    expect(interpolateVariables('{{user.profile.name}}', { user: { profile: { name: 'Ada' } } })).toBe('Ada');
  });

  it('prefers an exact flat key over a nested path', () => {
    expect(interpolateVariables('{{a.b}}', { 'a.b': 'flat', a: { b: 'nested' } })).toBe('flat');
  });

  it('coerces numbers and booleans to strings', () => {
    expect(interpolateVariables('{{n}}/{{f}}', { n: 42, f: false })).toBe('42/false');
  });

  it('serializes object values as JSON', () => {
    expect(interpolateVariables('{{o}}', { o: { x: 1 } })).toBe('{"x":1}');
  });

  it('does not re-scan interpolated values (single pass, no recursion)', () => {
    expect(interpolateVariables('{{a}}', { a: '{{b}}', b: 'deep' })).toBe('{{b}}');
  });

  it('returns undefined-path placeholders literally', () => {
    expect(interpolateVariables('{{a.b.c}}', { a: { b: null } })).toBe('{{a.b.c}}');
  });

  it('handles multiple placeholders in one template', () => {
    expect(interpolateVariables('{{a}}-{{b}}-{{a}}', { a: '1', b: '2' })).toBe('1-2-1');
  });
});

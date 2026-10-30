import { describe, expect, it } from 'vitest';
import { annotationPalette } from '@generatorai/design-tokens';
import { DEFAULT_ANNOTATION_PALETTE, sanitizeAnnotationPalette } from '../annotation-palette';

const valid = annotationPalette('github', 'light');

describe('sanitizeAnnotationPalette (06 §4.4)', () => {
  it('passes a valid palette through unchanged', () => {
    expect(sanitizeAnnotationPalette(valid)).toEqual(valid);
  });

  it('accepts upper-case hex and every rgba alpha form', () => {
    for (const shadow of ['rgba(0,0,0,0)', 'rgba(0,0,0,1)', 'rgba(1,4,9,.55)', 'rgba(255,255,255,0.141)']) {
      const input = { ...valid, accent: '#ABCDEF', shadow };
      expect(sanitizeAnnotationPalette(input)).toEqual(input);
    }
  });

  it('drops unknown keys', () => {
    const out = sanitizeAnnotationPalette({ ...valid, extra: "');alert(1);('" });
    expect(out).toEqual(valid);
    expect(Object.keys(out)).not.toContain('extra');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'dark'],
    ['a number', 42],
    ['an array', ['#000000']],
    ['an empty object', {}],
  ])('falls back to the default for %s', (_label, input) => {
    expect(sanitizeAnnotationPalette(input)).toEqual(DEFAULT_ANNOTATION_PALETTE);
  });

  it.each([
    ['a missing key', Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'danger'))],
    ['a short hex', { ...valid, accent: '#fff' }],
    ['an 8-digit hex', { ...valid, bg: '#000000ff' }],
    ['a named colour', { ...valid, text: 'red' }],
    ['a script injection', { ...valid, accent: "#000000';alert(1);'" }],
    ['a non-string value', { ...valid, sub: 0x123456 }],
    ['a spaced rgba shadow', { ...valid, shadow: 'rgba(0, 0, 0, 0.5)' }],
    ['an alpha above 1', { ...valid, shadow: 'rgba(0,0,0,2)' }],
    ['a hex shadow', { ...valid, shadow: '#000000' }],
    ['an injected shadow', { ...valid, shadow: 'rgba(0,0,0,.5);background:url(x)' }],
  ])('falls back to the default for %s', (_label, input) => {
    expect(sanitizeAnnotationPalette(input)).toEqual(DEFAULT_ANNOTATION_PALETTE);
  });

  it('returns a fresh object, never the frozen default', () => {
    const out = sanitizeAnnotationPalette(null);
    expect(out).not.toBe(DEFAULT_ANNOTATION_PALETTE);
    expect(Object.isFrozen(out)).toBe(false);
  });

  it('defaults to the default theme dark palette', () => {
    expect(DEFAULT_ANNOTATION_PALETTE).toEqual(annotationPalette('instrument', 'dark'));
  });
});

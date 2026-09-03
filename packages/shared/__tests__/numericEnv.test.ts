import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getConfigAudit,
  getConfigCorrections,
  readBoundedInt,
  resetConfigAudit,
} from '../src/config/numericEnv.js';

// These cases exist because the bare `parseInt(process.env.X ?? '8', 10)`
// pattern this replaces had a silent, unbounded-hang failure mode: a typo'd
// value became NaN, `new Semaphore(NaN)` accepted it, and every `acquire()`
// awaited a promise nobody resolved. The single most important assertion in
// this file is simply "the result is always a finite integer in range".

describe('readBoundedInt', () => {
  beforeEach(() => resetConfigAudit());

  it('uses the default when the variable is unset', () => {
    const v = readBoundedInt('X', { defaultValue: 8, min: 1, max: 16, env: {} });
    expect(v).toBe(8);
    expect(getConfigAudit()[0]?.action).toBe('default');
  });

  it('uses the default when the variable is empty or whitespace', () => {
    expect(readBoundedInt('X', { defaultValue: 8, min: 1, max: 16, env: { X: '' } })).toBe(8);
    expect(readBoundedInt('X', { defaultValue: 8, min: 1, max: 16, env: { X: '   ' } })).toBe(8);
  });

  it('returns a valid in-range value verbatim', () => {
    const v = readBoundedInt('X', { defaultValue: 8, min: 1, max: 16, env: { X: '12' } });
    expect(v).toBe(12);
    expect(getConfigAudit()[0]?.action).toBe('ok');
  });

  it('accepts surrounding whitespace', () => {
    expect(readBoundedInt('X', { defaultValue: 8, min: 1, max: 16, env: { X: ' 12 ' } })).toBe(12);
  });

  // The regression this whole module exists for.
  it.each(['abc', 'eight', 'NaN', '', 'Infinity', '-Infinity', '1e999'])(
    'never returns a non-finite value for input %j',
    (raw) => {
      const v = readBoundedInt('X', { defaultValue: 8, min: 1, max: 16, env: { X: raw } });
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(16);
    },
  );

  it('falls back to the default and warns for a non-numeric value', () => {
    const onWarn = vi.fn();
    const v = readBoundedInt('X', { defaultValue: 8, min: 1, max: 16, env: { X: 'abc' }, onWarn });
    expect(v).toBe(8);
    expect(onWarn).toHaveBeenCalledOnce();
    expect(getConfigAudit()[0]?.action).toBe('invalid');
  });

  it('rejects a fractional value rather than silently truncating it', () => {
    // `parseInt('2.9')` would have returned 2 with no signal; a fractional
    // permit count is a configuration mistake worth reporting.
    const onWarn = vi.fn();
    expect(readBoundedInt('X', { defaultValue: 8, min: 1, max: 16, env: { X: '2.9' }, onWarn })).toBe(8);
    expect(onWarn).toHaveBeenCalledOnce();
  });

  it('rejects trailing garbage that parseInt would have accepted', () => {
    // `parseInt('8abc', 10)` is 8 — a typo silently becomes a valid setting.
    expect(readBoundedInt('X', { defaultValue: 4, min: 1, max: 16, env: { X: '8abc' } })).toBe(4);
    expect(getConfigAudit()[0]?.action).toBe('invalid');
  });

  it('clamps above the maximum and warns', () => {
    const onWarn = vi.fn();
    const v = readBoundedInt('X', { defaultValue: 8, min: 1, max: 16, env: { X: '10000' }, onWarn });
    expect(v).toBe(16);
    expect(onWarn).toHaveBeenCalledOnce();
    expect(getConfigAudit()[0]?.action).toBe('clamped');
  });

  it('clamps below the minimum and warns', () => {
    const v = readBoundedInt('X', { defaultValue: 8, min: 2, max: 16, env: { X: '-5' } });
    expect(v).toBe(2);
    expect(getConfigAudit()[0]?.action).toBe('clamped');
  });

  it('throws for a nonsensical declared range', () => {
    expect(() => readBoundedInt('X', { defaultValue: 8, min: 16, max: 1, env: {} })).toThrow(RangeError);
  });

  it('throws when the declared default is itself out of range', () => {
    expect(() => readBoundedInt('X', { defaultValue: 99, min: 1, max: 16, env: {} })).toThrow(RangeError);
  });

  it('records an audit entry per variable, keeping the latest read', () => {
    readBoundedInt('A', { defaultValue: 1, min: 1, max: 4, env: { A: '2' } });
    readBoundedInt('B', { defaultValue: 1, min: 1, max: 4, env: { B: 'nope' } });
    readBoundedInt('A', { defaultValue: 1, min: 1, max: 4, env: { A: '3' } });

    const audit = getConfigAudit();
    expect(audit).toHaveLength(2);
    expect(audit.find((r) => r.name === 'A')?.effective).toBe(3);
  });

  it('getConfigCorrections reports only the reads that needed fixing', () => {
    readBoundedInt('OK', { defaultValue: 1, min: 1, max: 4, env: { OK: '2' } });
    readBoundedInt('BAD', { defaultValue: 1, min: 1, max: 4, env: { BAD: 'x' } });
    readBoundedInt('BIG', { defaultValue: 1, min: 1, max: 4, env: { BIG: '99' } });

    const names = getConfigCorrections().map((r) => r.name).sort();
    expect(names).toEqual(['BAD', 'BIG']);
  });
});

import { describe, it, expect } from 'vitest';
import { resolveRef, looksLikeId } from '../resolveRef.js';
import { CliError } from '../../errors/CliError.js';

const runs = [
  { id: 'a3f2c1d4-0000-4000-8000-000000000001', name: 'nightly e2e', status: 'running', createdAt: '2026-01-03T00:00:00Z' },
  { id: 'a3f2ffff-0000-4000-8000-000000000002', name: 'smoke', status: 'completed', createdAt: '2026-01-02T00:00:00Z' },
  { id: 'b7de0000-0000-4000-8000-000000000003', name: 'Nightly E2E', status: 'failed', createdAt: '2026-01-01T00:00:00Z' },
];

const opts = { kind: 'run', candidates: runs, activeStatuses: ['running'] };

describe('looksLikeId', () => {
  it('accepts a UUID and rejects a prefix', () => {
    expect(looksLikeId('a3f2c1d4-0000-4000-8000-000000000001')).toBe(true);
    expect(looksLikeId('a3f2')).toBe(false);
  });
});

describe('resolveRef', () => {
  it('resolves a full id without scanning names', () => {
    expect(resolveRef('b7de0000-0000-4000-8000-000000000003', opts).name).toBe('Nightly E2E');
  });

  it('resolves a unique id prefix', () => {
    expect(resolveRef('b7de', opts).id).toBe('b7de0000-0000-4000-8000-000000000003');
  });

  it('throws with candidates listed when a prefix is ambiguous', () => {
    // Silently picking the first match would resume the wrong run.
    try {
      resolveRef('a3f2', opts);
      expect.unreachable('expected an ambiguity error');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      const e = error as CliError;
      expect(e.code).toBe('AMBIGUOUS_REF');
      expect(e.suggestions?.length).toBe(2);
    }
  });

  it('resolves an exact name before a case-insensitive one', () => {
    expect(resolveRef('nightly e2e', opts).id).toBe('a3f2c1d4-0000-4000-8000-000000000001');
  });

  it('resolves @last to the newest by createdAt', () => {
    expect(resolveRef('@last', opts).name).toBe('nightly e2e');
  });

  it('resolves @active using activeStatuses', () => {
    expect(resolveRef('@active', opts).status).toBe('running');
  });

  it('resolves #n against the recent listing', () => {
    const withRecent = { ...opts, recent: runs.map((r) => r.id) };
    expect(resolveRef('#2', withRecent).name).toBe('smoke');
  });

  it('reports NOT_FOUND for an unknown ref', () => {
    expect(() => resolveRef('zzzz', opts)).toThrow(CliError);
  });

  it('reports NOT_FOUND rather than throwing on an empty candidate list', () => {
    expect(() => resolveRef('@last', { kind: 'run', candidates: [] })).toThrow(CliError);
  });
});

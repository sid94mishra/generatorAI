// ────────────────────────────────────────────────────────────────
// IdempotencyService: a claim a crashed process left behind (final review
// CONVINV-R7) answers what that execution created, or is freed once stale,
// instead of refusing the key for its whole TTL.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { IdempotencyService } from '../src/services/IdempotencyService.js';
import type { IIdempotencyKeyStore } from '../src/domain/ports/IInvocationStores.js';

/** A store holding one claim a crashed process left pending, `ageMs` old. */
function crashedStore(ageMs: number): IIdempotencyKeyStore {
  const rows = new Map<string, { executionId: string; createdAt: Date }>();
  rows.set('invoke:p|k1', { executionId: 'pending-invoke:p-k1', createdAt: new Date(Date.now() - ageMs) });
  return {
    async claim(r) {
      const k = `${r.scope}|${r.key}`;
      const e = rows.get(k);
      if (e) return { executionId: e.executionId, replay: true, requestHash: null, createdAt: e.createdAt };
      rows.set(k, { executionId: r.executionId, createdAt: r.createdAt });
      return { executionId: r.executionId, replay: false, requestHash: null };
    },
    async updateExecutionId(key, scope, executionId) {
      const e = rows.get(`${scope}|${key}`);
      if (e) e.executionId = executionId;
    },
    async release(key, scope, opts) {
      const e = rows.get(`${scope}|${key}`);
      if (e && (!opts?.createdBefore || e.createdAt < opts.createdBefore)) rows.delete(`${scope}|${key}`);
    },
    async sweepExpired() {
      return 0;
    },
  };
}

const opts = { key: 'k1', scope: 'invoke:p', ttlMs: 86_400_000, staleAfterMs: 5 * 60_000 };
const execute = async () => ({ executionId: 'run-new', value: 'new' });

describe('IdempotencyService after a crash (CONVINV-R7)', () => {
  it('replays the run the crashed execution created', async () => {
    const svc = new IdempotencyService(crashedStore(1000));
    const out = await svc.run({ ...opts, recover: async () => 'run-crashed' }, execute);
    expect(out).toEqual({ replayed: true, executionId: 'run-crashed' });
  });

  it('frees a stale claim with nothing to recover and executes', async () => {
    const svc = new IdempotencyService(crashedStore(10 * 60_000));
    const out = await svc.run({ ...opts, recover: async () => undefined }, execute);
    expect(out).toEqual({ replayed: false, executionId: 'run-new', value: 'new' });
  });

  it('a fresh pending claim is still in progress', async () => {
    const svc = new IdempotencyService(crashedStore(1000));
    await expect(svc.run({ ...opts, recover: async () => undefined }, execute)).rejects.toThrow(/still in progress/);
  });
});

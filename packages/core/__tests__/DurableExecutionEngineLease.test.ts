// ────────────────────────────────────────────────────────────────
// DurableExecutionEngine — iteration claim LEASES (P0-c).
//
// `claimNextIteration` used to be a one-way door: it flipped the slot's
// `resolved` flag and nothing ever wrote back. A claimed slot and a finished
// slot were byte-identical, so a process that died mid-iteration lost that
// row permanently — and, worse, silently, because recovery could not tell the
// two apart and had no reason to look. These tests cover the three pieces
// that close it: the lease stamped at claim time, the completion write, and
// the reclaim pass.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDB, migrateDB, EntryRepository, RegisterRepository, type AppDatabase } from '@generatorai/db';
import type { ILogger } from '@generatorai/shared';

import {
  DurableExecutionEngine,
  type IterationSlotPayload,
} from '../src/services/DurableExecutionEngine.js';

function mockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger;
}

let dir: string;
let db: AppDatabase;
let entryRepo: EntryRepository;
let engine: DurableExecutionEngine;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-durable-lease-'));
  db = createDB(join(dir, 'd.db'));
  migrateDB(db);
  entryRepo = new EntryRepository(db);
  engine = new DurableExecutionEngine(new RegisterRepository(db), entryRepo, mockLogger());
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

function makeIterations(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    variables: { i },
    label: `iteration ${i}`,
  }));
}

/** Read a slot's payload straight out of the entries table. */
function slotPayload(slotId: string): IterationSlotPayload {
  return entryRepo.getById(slotId)!.payload as IterationSlotPayload;
}

describe('DurableExecutionEngine — iteration leases (P0-c)', () => {
  it('stamps a lease on the slot when it is claimed', () => {
    engine.initializeIterations('exec-1', makeIterations(3));

    const before = Date.now();
    const claimed = engine.claimNextIteration('exec-1')!;
    const payload = slotPayload(claimed.id);

    expect(payload.status).toBe('running');
    expect(payload.owner).toBeTruthy();
    expect(payload.claimedAt).toBeGreaterThanOrEqual(before);
    // The iteration's own data survives the claim untouched.
    expect(payload.index).toBe(0);
    expect(payload.variables).toEqual({ i: 0 });
  });

  it('completeIteration records the outcome, so the slot is no longer reclaimable', () => {
    engine.initializeIterations('exec-2', makeIterations(3));
    const claimed = engine.claimNextIteration('exec-2')!;

    engine.completeIteration(claimed.id, 'completed');

    const payload = slotPayload(claimed.id);
    expect(payload.status).toBe('completed');
    expect(payload.completedAt).toBeGreaterThan(0);

    // Even with a zero lease, a finished slot is never handed back.
    expect(engine.reclaimExpiredIterations('exec-2', { leaseMs: 0 })).toEqual([]);
  });

  it('records a failed iteration with its error, and does not re-issue it either', () => {
    engine.initializeIterations('exec-3', makeIterations(2));
    const claimed = engine.claimNextIteration('exec-3')!;

    engine.completeIteration(claimed.id, 'failed', 'workflow blew up');

    expect(slotPayload(claimed.id)).toMatchObject({ status: 'failed', error: 'workflow blew up' });
    expect(engine.reclaimExpiredIterations('exec-3', { leaseMs: 0 })).toEqual([]);
  });

  it('reclaims a slot whose owner died mid-iteration, and re-issues that exact index', () => {
    engine.initializeIterations('exec-4', makeIterations(5));

    // Two finish cleanly; the third is claimed and its process "dies" — no
    // completion write ever lands.
    for (let i = 0; i < 2; i += 1) {
      engine.completeIteration(engine.claimNextIteration('exec-4')!.id, 'completed');
    }
    const abandoned = engine.claimNextIteration('exec-4')!;
    expect(abandoned.index).toBe(2);

    // Before the reclaim, index 2 is invisible: the next claim skips to 3.
    expect(engine.countPendingIterations('exec-4')).toBe(2);

    const reclaimed = engine.reclaimExpiredIterations('exec-4', { leaseMs: 0 });
    expect(reclaimed).toEqual([2]);
    expect(slotPayload(abandoned.id).status).toBe('pending');
    expect(slotPayload(abandoned.id).reclaimCount).toBe(1);

    // A fresh engine (a restarted process) picks the work back up in order.
    const restarted = new DurableExecutionEngine(
      new RegisterRepository(db),
      new EntryRepository(db),
      mockLogger(),
    );
    const order: number[] = [];
    for (;;) {
      const next = restarted.claimNextIteration('exec-4');
      if (!next) break;
      order.push(next.index);
    }
    expect(order).toEqual([2, 3, 4]);
  });

  it('leaves a slot claimed while its lease is still valid', () => {
    engine.initializeIterations('exec-5', makeIterations(2));
    const claimed = engine.claimNextIteration('exec-5')!;

    expect(engine.reclaimExpiredIterations('exec-5', { leaseMs: 60_000 })).toEqual([]);
    expect(slotPayload(claimed.id).status).toBe('running');
  });

  it('skipIndexes protects an iteration whose work is genuinely still running', () => {
    engine.initializeIterations('exec-6', makeIterations(4));
    const a = engine.claimNextIteration('exec-6')!;
    const b = engine.claimNextIteration('exec-6')!;

    // `a` is known to still be live (its workflow run has not settled);
    // `b`'s owner is gone.
    const reclaimed = engine.reclaimExpiredIterations('exec-6', { leaseMs: 0, skipIndexes: [a.index] });

    expect(reclaimed).toEqual([b.index]);
    expect(slotPayload(a.id).status).toBe('running');
    expect(slotPayload(b.id).status).toBe('pending');
  });

  it('reclaims a slot claimed before leases existed (no claimedAt on the payload)', () => {
    // A database written by the pre-lease build: `resolved = 1` with a payload
    // that still says `pending` and carries no lease at all. Leaving those
    // claimed forever is the same permanent loss the lease exists to prevent.
    engine.initializeIterations('exec-7', makeIterations(1));
    const slot = entryRepo.findNextPendingIteration('automation_execution', 'exec-7')!;
    entryRepo.resolve(slot.id); // claim WITHOUT writing a lease

    expect(engine.reclaimExpiredIterations('exec-7', { leaseMs: 60_000 })).toEqual([0]);
    expect(engine.claimNextIteration('exec-7')?.index).toBe(0);
  });

  it('countPendingIterations tracks only unclaimed slots', () => {
    engine.initializeIterations('exec-8', makeIterations(4));
    expect(engine.countPendingIterations('exec-8')).toBe(4);

    engine.claimNextIteration('exec-8');
    expect(engine.countPendingIterations('exec-8')).toBe(3);

    engine.completeIteration(engine.claimNextIteration('exec-8')!.id, 'completed');
    expect(engine.countPendingIterations('exec-8')).toBe(2);
  });
});

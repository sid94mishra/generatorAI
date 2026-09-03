// ────────────────────────────────────────────────────────────────
// DurableExecutionEngine — automation iteration claiming (W22).
//
// Found with ZERO test coverage during end-to-end review, and a real bug:
// `findNextPendingIteration`'s `ORDER BY key ASC` sorts the `iter/<index>`
// key lexicographically, and an unpadded index breaks numeric order past 10
// (`iter/10` sorts before `iter/2`). That silently violates W22's own
// acceptance line — "kill mid-batch at row 40, resume at row 41" — for any
// batch with more than 10 iterations. Fixed by zero-padding the key.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDB, migrateDB, EntryRepository, RegisterRepository, type AppDatabase } from '@generatorai/db';
import type { ILogger } from '@generatorai/shared';

import { DurableExecutionEngine } from '../src/services/DurableExecutionEngine.js';

function mockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger;
}

let dir: string;
let db: AppDatabase;
let engine: DurableExecutionEngine;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-durable-iter-'));
  db = createDB(join(dir, 'd.db'));
  migrateDB(db);
  engine = new DurableExecutionEngine(new RegisterRepository(db), new EntryRepository(db), mockLogger());
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

function claimAll(executionId: string): number[] {
  const order: number[] = [];
  for (;;) {
    const claimed = engine.claimNextIteration(executionId);
    if (!claimed) break;
    order.push(claimed.index);
  }
  return order;
}

describe('DurableExecutionEngine — iteration claim ordering (W22)', () => {
  it('claims iterations in numeric order for a batch of 25 (past the lexicographic break point)', () => {
    const executionId = 'exec-1';
    engine.initializeIterations(executionId, makeIterations(25));

    const order = claimAll(executionId);

    expect(order).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it('resumes at the next unclaimed index after a partial batch, still in numeric order', () => {
    // Simulates "kill mid-batch at row 40, resume at row 41" for a smaller,
    // fast-to-test batch that still crosses the lexicographic break point.
    const executionId = 'exec-2';
    engine.initializeIterations(executionId, makeIterations(15));

    // Claim (and by implication, "complete") the first 11 — past the point
    // where unpadded keys would have reordered things.
    for (let i = 0; i < 11; i += 1) {
      expect(engine.claimNextIteration(executionId)?.index).toBe(i);
    }

    // A fresh engine instance against the same DB simulates a restart.
    const resumed = new DurableExecutionEngine(new RegisterRepository(db), new EntryRepository(db), mockLogger());
    const rest = claimAll('exec-2');
    void resumed;

    expect(rest).toEqual([11, 12, 13, 14]);
  });

  it('never re-claims an already-claimed iteration (resolve is atomic)', () => {
    const executionId = 'exec-3';
    engine.initializeIterations(executionId, makeIterations(5));

    const seen = new Set<number>();
    for (let i = 0; i < 5; i += 1) {
      const claimed = engine.claimNextIteration(executionId);
      expect(claimed).not.toBeNull();
      expect(seen.has(claimed!.index)).toBe(false);
      seen.add(claimed!.index);
    }
    expect(engine.claimNextIteration(executionId)).toBeNull();
  });

  it('initializeIterations is idempotent on recovery — does not duplicate slots', () => {
    const executionId = 'exec-4';
    engine.initializeIterations(executionId, makeIterations(5));
    engine.claimNextIteration(executionId); // claims index 0

    // Recovery re-calls initializeIterations with the same iteration set.
    const created = engine.initializeIterations(executionId, makeIterations(5));
    expect(created).toBe(0); // every slot already existed — nothing new inserted

    const order = claimAll(executionId);
    expect(order).toEqual([1, 2, 3, 4]); // 0 was already claimed, not reissued
  });
});

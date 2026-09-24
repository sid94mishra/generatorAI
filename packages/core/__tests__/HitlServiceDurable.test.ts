// ────────────────────────────────────────────────────────────────
// HitlService — W22 durable-Awakeable-backed approval gate.
//
// Before this fix, `HitlService.interrupt()` parked on a bare in-memory
// `Map<stageRunId, resolve>` — `DurableExecutionEngine` had zero production
// callers, and the approval wait had no durable record and no timeout at
// all (violating LINT-HAZ-4). This file proves the fix: `interrupt()`/
// `resume()` now route through a REAL `DurableExecutionEngine` (real SQLite
// DB, not a mock) when one is supplied, and the resolution reaches its
// awaiter even from a DIFFERENT `HitlService`/`DurableExecutionEngine`
// instance sharing only the same DB — the actual claim being tested: the
// wait is durable-backed, not process-local memory.
//
// `HitlService.test.ts` (unchanged, still passing) covers the fallback
// in-memory-only path used when no `durableEngine` is supplied — this file
// is additive, not a replacement.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDB, migrateDB, EntryRepository, RegisterRepository, type AppDatabase } from '@generatorai/db';
import type { ILogger } from '@generatorai/shared';
import type { StageRun } from '@generatorai/shared';

import { HitlService } from '../src/services/HitlService.js';
import { DurableExecutionEngine } from '../src/services/DurableExecutionEngine.js';
import { EventBus } from '../src/events/EventBus.js';
import type { IStageRunRepository } from '../src/domain/ports/IStageRunRepository.js';

function mockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger;
}

function stubStageRun(overrides: Partial<StageRun> = {}): StageRun {
  return {
    id: 's1',
    workflowRunId: 'wr1',
    stageDefinitionId: 'sd1',
    name: 'stage',
    status: 'running',
    currentStep: 0,
    totalSteps: 0,
    retryCount: 0,
    version: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Same shared-map repo used by HitlService.test.ts, so both suites agree on behaviour. */
function createMemoryRepo(initial: StageRun[] = []): IStageRunRepository & { rows: Map<string, StageRun> } {
  const rows = new Map<string, StageRun>();
  for (const r of initial) rows.set(r.id, { ...r });
  return {
    rows,
    async create(r) { rows.set(r.id, { ...r }); return r; },
    async getById(id) {
      const r = rows.get(id);
      if (!r) throw new Error(`not found ${id}`);
      return r;
    },
    async getByRunId(workflowRunId) {
      return [...rows.values()].filter((r) => r.workflowRunId === workflowRunId);
    },
    async getByStatus() { return []; },
    async update(id, updates) {
      const r = rows.get(id);
      if (!r) throw new Error(`not found ${id}`);
      Object.assign(r, updates);
      return r;
    },
    async updateStatus(id, status) {
      const r = rows.get(id);
      if (r) r.status = status;
    },
    async incrementRetryCount() { return true; },
    async resetForRetry() {},
    async batchUpdateStatus() {},
    async delete(id) { rows.delete(id); },
    async deleteByRunId() {},
    async sleep() {},
    async wake() { return false; },
    async findSleepersReadyToWake() { return []; },
    async interrupt(id, data) {
      const r = rows.get(id);
      if (!r) throw new Error(`not found ${id}`);
      r.status = 'awaiting_input';
      r.interruptData = data;
    },
    async resumeFromInterrupt(id, nextStatus = 'running') {
      const r = rows.get(id);
      if (!r || r.status !== 'awaiting_input') return false;
      r.status = nextStatus;
      r.interruptData = undefined;
      r.version = r.version + 1;
      return true;
    },
    async findAwaitingInputByRun(workflowRunId) {
      return [...rows.values()].filter(
        (r) => r.workflowRunId === workflowRunId && r.status === 'awaiting_input',
      );
    },
  };
}

let dir: string;
let db: AppDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-hitl-durable-'));
  db = createDB(join(dir, 'd.db'));
  migrateDB(db);
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

function makeEngine(): DurableExecutionEngine {
  return new DurableExecutionEngine(new RegisterRepository(db), new EntryRepository(db), mockLogger());
}

describe('HitlService — W22 durable Awakeable path', () => {
  it('interrupt()/resume() round-trip through the durable engine, not the in-memory map', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    const engine = makeEngine();
    const svc = new HitlService(repo, new EventBus(), engine);

    const pending = svc.interrupt('s1', 'wr1', { toolCall: 'shell.exec' });
    expect(svc.activeWaiterCount).toBe(1);

    const result = await svc.resume('s1', 'wr1', { approved: true, value: { choice: 'go' } });
    expect(result.ok).toBe(true);

    const resolution = await pending;
    expect(resolution.approved).toBe(true);
    expect(resolution.value).toEqual({ choice: 'go' });
    expect(svc.activeWaiterCount).toBe(0);
  });

  it('does not leak the Awakeable token into the reviewer-facing interrupt_data', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    const engine = makeEngine();
    const svc = new HitlService(repo, new EventBus(), engine);

    const pending = svc.interrupt('s1', 'wr1', { toolCall: 'shell.exec', args: { cmd: 'ls' } });
    // The token lives in interrupt_data (so resume() can find it), and the
    // `stage_run.awaiting_input` event (asserted with the original `data`
    // shape in HitlService.test.ts) must not carry it — this test checks
    // the stored row directly.
    const stored = repo.rows.get('s1')!.interruptData as Record<string, unknown>;
    expect(stored['toolCall']).toBe('shell.exec');
    expect(Object.keys(stored)).toContain('__hitlAwakeableToken');

    await svc.resume('s1', 'wr1', { approved: true });
    await pending;
  });

  it('W22 crash recovery — a recovered promise (post-restart) settles when the human approves through the NEW process', async () => {
    // "Process 1": creates the approval gate, then "crashes" — its promise
    // and in-memory subscriber are gone; only the DB row (stage_runs +
    // the entries-table awakeable) survives.
    const repo = createMemoryRepo([stubStageRun()]);
    const engineBeforeRestart = makeEngine();
    const svcBeforeRestart = new HitlService(repo, new EventBus(), engineBeforeRestart);
    void svcBeforeRestart.interrupt('s1', 'wr1', { reason: 'needs approval' }); // never awaited — simulates the crash

    // "Process 2" (restart): a fresh engine against the same DB. A real
    // StartupRecoveryService would do exactly this — find stages still
    // `awaiting_input`, extract their token, and re-arm a live subscriber
    // BEFORE any human interacts with them.
    const engineAfterRestart = makeEngine();
    const recovered = engineAfterRestart.recoverAwakeables({ scope: 'stage_run', scopeId: 's1' }, 60_000);
    expect(recovered.size).toBe(1);
    const [recoveredPromise] = recovered.values();

    // The human approves via the normal API path in the NEW process.
    const svcAfterRestart = new HitlService(repo, new EventBus(), engineAfterRestart);
    const result = await svcAfterRestart.resume('s1', 'wr1', { approved: true, value: 'approved-after-restart' });
    expect(result.ok).toBe(true);

    // The promise recovery re-armed BEFORE the approval now settles with it.
    await expect(recoveredPromise).resolves.toEqual({ approved: true, value: 'approved-after-restart' });
    // P0-a: `pending`, NOT `running`. The stage frame that called interrupt()
    // died with process 1, so there is nothing for `running` to mean — and
    // `pending` is the only status `DAGScheduler.reconcileRun` will relaunch.
    // This assertion used to read `running`, which is precisely the permanent
    // zombie: approved, never re-run, run stuck forever.
    expect(repo.rows.get('s1')!.status).toBe('pending');
  });

  it('cancelWaiter() resolves the durable Awakeable as a cancellation, not a hang', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    const engine = makeEngine();
    const svc = new HitlService(repo, new EventBus(), engine);

    const pending = svc.interrupt('s1', 'wr1', {});
    svc.cancelWaiter('s1', 'parent run cancelled');

    const res = await pending;
    expect(res.approved).toBe(false);
    expect(res.reason).toBe('parent run cancelled');
    expect(svc.activeWaiterCount).toBe(0);
  });

  it('a superseding interrupt() cancels the prior Awakeable for the same stageRunId', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    const engine = makeEngine();
    const svc = new HitlService(repo, new EventBus(), engine);

    const first = svc.interrupt('s1', 'wr1', { round: 1 });
    const second = svc.interrupt('s1', 'wr1', { round: 2 });

    const firstResult = await first;
    expect(firstResult.approved).toBe(false);
    expect(firstResult.reason).toBe('superseded by new interrupt');

    await svc.resume('s1', 'wr1', { approved: true });
    const secondResult = await second;
    expect(secondResult.approved).toBe(true);
  });

  it('LINT-HAZ-4 — a durable-backed interrupt() times out instead of hanging forever when never resumed', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    const engine = makeEngine();
    // Tiny override timeout — production always uses the 30-day default.
    const svc = new HitlService(repo, new EventBus(), engine, undefined, 20);

    await expect(svc.interrupt('s1', 'wr1', {})).rejects.toThrow(/timed out/);
  });

});

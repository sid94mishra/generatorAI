// ────────────────────────────────────────────────────────────────
// HitlService — P0-a: an approved HITL stage must not become a zombie.
//
// The defect: `resume()` always wrote `awaiting_input → running`. That is
// correct only while the `interrupt()` frame is still alive to be resumed by
// the resolved promise. After a restart that frame is gone, and `running` is
// a status NOTHING relaunches — `DAGScheduler.reconcileRun` only considers
// `pending`, `StartupRecoveryService` deliberately leaves `awaiting_input`
// alone, and the `/approve` route's promise died with the process. The
// approval was accepted, the stage never ran again, and the run sat in
// `running` forever.
//
// The fix has three parts, one test group each:
//   1. resume() picks the destination status from whether a live awaiter
//      exists, so a post-restart approval lands in `pending`.
//   2. It re-drives the parent run, so something actually relaunches it.
//   3. The relaunched stage's `interrupt()` collects the verdict already
//      given instead of asking the same human the same question again.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDB, migrateDB, EntryRepository, RegisterRepository, type AppDatabase } from '@generatorai/db';
import type { ILogger, StageRun } from '@generatorai/shared';

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

/**
 * In-memory stage-run repo that honours `resumeFromInterrupt`'s destination
 * status — the whole point of the fix, so a mock that hardcoded `running`
 * would assert nothing.
 */
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
    async claimForExecution() { return true; },
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
  dir = mkdtempSync(join(tmpdir(), 'gai-hitl-restart-'));
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

const REVIEW_GATE = { kind: 'stage_completion_review', stageName: 'stage', reviewRound: 1 };

describe('HitlService — P0-a: a post-restart approval must relaunch the stage', () => {
  it('parks the stage in `pending`, not `running`, when no live awaiter survives', async () => {
    const repo = createMemoryRepo([stubStageRun()]);

    // Process 1 parks the gate, then dies — its promise is never awaited.
    const engine1 = makeEngine();
    void new HitlService(repo, new EventBus(), mockLogger(), engine1).interrupt('s1', 'wr1', REVIEW_GATE);
    expect(repo.rows.get('s1')!.status).toBe('awaiting_input');

    // Process 2: a fresh service against the same DB. The human approves.
    const redriven: string[] = [];
    const svc2 = new HitlService(
      repo,
      new EventBus(),
      mockLogger(),
      makeEngine(),
      undefined,
      async (runId) => { redriven.push(runId); },
    );
    const result = await svc2.resume('s1', 'wr1', { approved: true });

    expect(result.ok).toBe(true);
    // `running` here is the zombie: no scheduler path relaunches it.
    expect(repo.rows.get('s1')!.status).toBe('pending');
    expect(redriven).toEqual(['wr1']);
  });

  it('still uses `running` — and does NOT re-drive — when the interrupt frame is alive', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    const redriven: string[] = [];
    const svc = new HitlService(
      repo,
      new EventBus(),
      mockLogger(),
      makeEngine(),
      undefined,
      async (runId) => { redriven.push(runId); },
    );

    const pending = svc.interrupt('s1', 'wr1', REVIEW_GATE);
    const result = await svc.resume('s1', 'wr1', { approved: true });

    expect(result.ok).toBe(true);
    expect(repo.rows.get('s1')!.status).toBe('running');
    // Re-driving here would race the live frame into a duplicate launch.
    expect(redriven).toEqual([]);
    await expect(pending).resolves.toMatchObject({ approved: true });
  });

  it('works on the in-memory fallback path too (no durableEngine)', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    void new HitlService(repo, new EventBus()).interrupt('s1', 'wr1', REVIEW_GATE);

    const redriven: string[] = [];
    const svc2 = new HitlService(
      repo,
      new EventBus(),
      mockLogger(),
      undefined,
      undefined,
      async (runId) => { redriven.push(runId); },
    );
    await svc2.resume('s1', 'wr1', { approved: true });

    expect(repo.rows.get('s1')!.status).toBe('pending');
    expect(redriven).toEqual(['wr1']);
  });

  it('reports the failure instead of claiming success when the re-drive throws', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    void new HitlService(repo, new EventBus(), mockLogger(), makeEngine()).interrupt('s1', 'wr1', REVIEW_GATE);

    const svc2 = new HitlService(
      repo,
      new EventBus(),
      mockLogger(),
      makeEngine(),
      undefined,
      async () => { throw new Error('definition was deleted'); },
    );
    const result = await svc2.resume('s1', 'wr1', { approved: true });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/definition was deleted/);
  });

  it('records the verdict on the row even when the approver supplied no value', async () => {
    // Previously interrupt_data was only rewritten when `resolution.value`
    // was defined — i.e. never for a plain "approve", which is the case a
    // relaunched stage most needs to read back.
    const repo = createMemoryRepo([stubStageRun()]);
    const svc = new HitlService(repo, new EventBus(), mockLogger(), makeEngine());
    const pending = svc.interrupt('s1', 'wr1', REVIEW_GATE);
    await svc.resume('s1', 'wr1', { approved: true, reason: 'looks good' });
    await pending;

    expect(repo.rows.get('s1')!.interruptData).toMatchObject({
      approved: true,
      reason: 'looks good',
    });
  });
});

describe('HitlService — P0-a: the relaunched stage does not re-ask the human', () => {
  it('returns the verdict already given instead of parking a second time', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    void new HitlService(repo, new EventBus(), mockLogger(), makeEngine()).interrupt('s1', 'wr1', REVIEW_GATE);

    const svc2 = new HitlService(repo, new EventBus(), mockLogger(), makeEngine());
    await svc2.resume('s1', 'wr1', { approved: true, value: { choice: 'go' } });
    expect(repo.rows.get('s1')!.status).toBe('pending');

    // The scheduler relaunches the stage; it re-runs its work and reaches the
    // same gate. It must NOT park again.
    repo.rows.get('s1')!.status = 'running';
    const resolution = await svc2.interrupt('s1', 'wr1', REVIEW_GATE);

    expect(resolution).toMatchObject({ approved: true, value: { choice: 'go' } });
    expect(repo.rows.get('s1')!.status).toBe('running'); // never re-parked

    // One-shot: a genuine second review round parks for real.
    const second = svc2.interrupt('s1', 'wr1', { ...REVIEW_GATE, reviewRound: 2 });
    expect(repo.rows.get('s1')!.status).toBe('awaiting_input');
    svc2.cancelWaiter('s1', 'test cleanup');
    await second;
  });

  it('does not let a verdict for one gate answer a different gate', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    void new HitlService(repo, new EventBus(), mockLogger(), makeEngine())
      .interrupt('s1', 'wr1', REVIEW_GATE);

    const svc2 = new HitlService(repo, new EventBus(), mockLogger(), makeEngine());
    await svc2.resume('s1', 'wr1', { approved: true });

    // The relaunched stage hits a tool-permission prompt on its way back to
    // the approval gate. Answering that with the stage approval would grant a
    // permission no human ever saw.
    repo.rows.get('s1')!.status = 'running';
    const permission = svc2.interrupt('s1', 'wr1', { kind: 'tool_permission', tool: 'shell.exec' });
    expect(repo.rows.get('s1')!.status).toBe('awaiting_input');
    svc2.cancelWaiter('s1', 'test cleanup');
    await permission;
  });

  it('drops a held verdict when the stage is cancelled', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    void new HitlService(repo, new EventBus(), mockLogger(), makeEngine()).interrupt('s1', 'wr1', REVIEW_GATE);

    const svc2 = new HitlService(repo, new EventBus(), mockLogger(), makeEngine());
    await svc2.resume('s1', 'wr1', { approved: true });
    svc2.cancelWaiter('s1', 'parent run cancelled');

    // A later gate on the same row must park, not inherit the dead verdict.
    repo.rows.get('s1')!.status = 'running';
    const later = svc2.interrupt('s1', 'wr1', REVIEW_GATE);
    expect(repo.rows.get('s1')!.status).toBe('awaiting_input');
    svc2.cancelWaiter('s1', 'test cleanup');
    await later;
  });
});

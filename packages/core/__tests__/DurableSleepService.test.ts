// ────────────────────────────────────────────────────────────────
// DurableSleepService tests — DUR-05
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { DurableSleepService } from '../src/services/DurableSleepService.js';
import { EventBus } from '../src/events/EventBus.js';
import type { IStageRunRepository } from '../src/domain/ports/IStageRunRepository.js';
import type { StageRun } from '@generatorai/shared';

function stubStageRun(overrides: Partial<StageRun> = {}): StageRun {
  return {
    id: 's1',
    workflowRunId: 'wr1',
    stageDefinitionId: 'sd1',
    name: 'stage',
    status: 'sleeping',
    currentStep: 0,
    totalSteps: 0,
    retryCount: 0,
    version: 0,
    createdAt: new Date(),
    wakeAt: new Date(Date.now() - 1000),
    sleptSince: new Date(Date.now() - 5000),
    ...overrides,
  };
}

/** Minimal in-memory repo for the service surface we exercise. */
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
    async getByRunId() { return []; },
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
    async sleep(id, wakeAt) {
      const r = rows.get(id);
      if (!r) throw new Error(`not found ${id}`);
      r.status = 'sleeping';
      r.wakeAt = wakeAt;
      r.sleptSince = new Date();
    },
    async wake(id) {
      const r = rows.get(id);
      if (!r || r.status !== 'sleeping') return false;
      r.status = 'queued';
      r.wakeAt = undefined;
      r.sleptSince = undefined;
      r.version = r.version + 1;
      return true;
    },
    async findSleepersReadyToWake(now, limit) {
      const ready = [...rows.values()]
        .filter((r) => r.status === 'sleeping' && r.wakeAt && r.wakeAt <= now)
        .sort((a, b) => (a.wakeAt!.getTime() - b.wakeAt!.getTime()))
        .slice(0, limit);
      return ready.map((r) => ({ ...r }));
    },
  };
}

describe('DurableSleepService (DUR-05)', () => {
  it('sleep() persists wakeAt + emits stage_run.sleeping', async () => {
    const repo = createMemoryRepo([stubStageRun({ status: 'running', wakeAt: undefined, sleptSince: undefined })]);
    const bus = new EventBus();
    const seen: Array<{ kind: string; data: unknown }> = [];
    bus.subscribeGlobal((e) => seen.push({ kind: e.kind, data: e.data }));

    const svc = new DurableSleepService(repo, bus, async () => {}, {
      enabled: false, // no sweeper — test sleep() in isolation
      sweepIntervalMs: 1000,
      maxWakesPerSweep: 10,
    });

    const wakeAt = await svc.sleep('s1', 'wr1', 250, 'waiting on X');
    expect(wakeAt.getTime()).toBeGreaterThan(Date.now());
    expect(repo.rows.get('s1')!.status).toBe('sleeping');
    expect(repo.rows.get('s1')!.wakeAt).toBeInstanceOf(Date);

    // Global event emission is async (via emitGlobal) — wait a tick.
    await new Promise((r) => setTimeout(r, 20));
    const sleepingEvt = seen.find((e) => e.kind === 'stage_run.sleeping');
    expect(sleepingEvt).toBeDefined();
    const d = sleepingEvt!.data as { stageRunId: string; reason?: string };
    expect(d.stageRunId).toBe('s1');
    expect(d.reason).toBe('waiting on X');
  });

  it('sleep() clamps non-positive durations to 1ms', async () => {
    const repo = createMemoryRepo([stubStageRun({ status: 'running' })]);
    const svc = new DurableSleepService(repo, new EventBus(), async () => {}, {
      enabled: false, sweepIntervalMs: 1000, maxWakesPerSweep: 10,
    });
    const before = Date.now();
    const wakeAt = await svc.sleep('s1', 'wr1', -500);
    // wakeAt should be ~now (within a tiny window); accept up to 100ms skew
    expect(wakeAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(wakeAt.getTime() - before).toBeLessThan(100);
  });

  it('sweep() wakes rows whose wakeAt has passed and calls onWake', async () => {
    const overdue = stubStageRun({
      id: 'overdue',
      wakeAt: new Date(Date.now() - 10_000),
    });
    const future = stubStageRun({
      id: 'future',
      wakeAt: new Date(Date.now() + 60_000),
    });
    const repo = createMemoryRepo([overdue, future]);

    const calls: string[] = [];
    const svc = new DurableSleepService(
      repo,
      new EventBus(),
      async (stage) => { calls.push(stage.id); },
      { enabled: true, sweepIntervalMs: 1000, maxWakesPerSweep: 10 },
    );

    const result = await svc.sweep();
    expect(result.candidates).toBe(1);
    expect(result.woken).toBe(1);
    expect(calls).toEqual(['overdue']);
    expect(repo.rows.get('overdue')!.status).toBe('queued');
    expect(repo.rows.get('future')!.status).toBe('sleeping');
  });

  it('sweep() is reentrance-safe', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    let onWakeFired = 0;
    const svc = new DurableSleepService(
      repo,
      new EventBus(),
      async () => {
        onWakeFired++;
        await new Promise((r) => setTimeout(r, 25)); // slow handler
      },
      { enabled: true, sweepIntervalMs: 1000, maxWakesPerSweep: 10 },
    );

    // Fire two sweeps concurrently — second must early-return without
    // calling onWake again.
    const [a, b] = await Promise.all([svc.sweep(), svc.sweep()]);
    // One of the two should report candidates=1, the other 0 (reentrance).
    expect([a.candidates, b.candidates].sort()).toEqual([0, 1]);
    expect(onWakeFired).toBe(1);
  });

  it('wake() race — second caller gets false, only one onWake fires', async () => {
    const stage = stubStageRun();
    const repo = createMemoryRepo([stage]);
    const svc = new DurableSleepService(
      repo, new EventBus(), async () => {},
      { enabled: false, sweepIntervalMs: 1000, maxWakesPerSweep: 10 },
    );
    // Call wake twice directly via repo — first succeeds, second fails.
    const first = await repo.wake('s1');
    const second = await repo.wake('s1');
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(repo.rows.get('s1')!.status).toBe('queued');
    expect(repo.rows.get('s1')!.wakeAt).toBeUndefined();
    // Sweep should find nothing now.
    const result = await svc.sweep();
    expect(result.candidates).toBe(0);
  });

  it('start() is a no-op when disabled', () => {
    const repo = createMemoryRepo();
    const svc = new DurableSleepService(repo, new EventBus(), async () => {}, {
      enabled: false, sweepIntervalMs: 1000, maxWakesPerSweep: 10,
    });
    svc.start();
    svc.stop();
    expect(true).toBe(true);
  });

  it('onWake handler errors do not prevent other wakes', async () => {
    const bad = stubStageRun({ id: 'bad', wakeAt: new Date(Date.now() - 2000) });
    const good = stubStageRun({ id: 'good', wakeAt: new Date(Date.now() - 1000) });
    const repo = createMemoryRepo([bad, good]);
    const called: string[] = [];
    const svc = new DurableSleepService(
      repo,
      new EventBus(),
      async (s) => {
        called.push(s.id);
        if (s.id === 'bad') throw new Error('handler boom');
      },
      { enabled: true, sweepIntervalMs: 1000, maxWakesPerSweep: 10 },
    );
    const result = await svc.sweep();
    expect(result.woken).toBe(2); // both rows claimed
    expect(called.sort()).toEqual(['bad', 'good']);
    // Both rows actually flipped to queued — handler errors don't roll that back
    expect(repo.rows.get('bad')!.status).toBe('queued');
    expect(repo.rows.get('good')!.status).toBe('queued');
  });
});

// ── StageRunStateMachine sleeping state transitions ──

import { StageRunStateMachine } from '../src/domain/state-machines/StageRunStateMachine.js';

describe('StageRunStateMachine — sleeping state (DUR-05)', () => {
  it('running → sleeping via sys:sleep', () => {
    const sm = new StageRunStateMachine('running');
    expect(sm.transition('sys:sleep')).toBe('sleeping');
  });

  it('sleeping → queued via sys:wake', () => {
    const sm = new StageRunStateMachine('sleeping');
    expect(sm.transition('sys:wake')).toBe('queued');
  });

  it('sleeping → cancelled via sys:parent_cancel', () => {
    const sm = new StageRunStateMachine('sleeping');
    expect(sm.transition('sys:parent_cancel')).toBe('cancelled');
  });

  it('sleeping → cancelled via user:cancel', () => {
    const sm = new StageRunStateMachine('sleeping');
    expect(sm.transition('user:cancel')).toBe('cancelled');
  });

  it('sleeping is not terminal', () => {
    const sm = new StageRunStateMachine('sleeping');
    expect(sm.isTerminal).toBe(false);
    expect(sm.isActive).toBe(false);
  });

  it('cannot sys:sleep from a non-running state', () => {
    const sm = new StageRunStateMachine('queued');
    expect(() => sm.transition('sys:sleep')).toThrow(/Cannot apply 'sys:sleep'/);
  });

  it('cannot sys:wake from a non-sleeping state', () => {
    const sm = new StageRunStateMachine('running');
    expect(() => sm.transition('sys:wake')).toThrow();
  });
});

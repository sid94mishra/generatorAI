// ────────────────────────────────────────────────────────────────
// HitlService tests — HITL-01..05
//
// Covers:
// - interrupt() persists status + interrupt_data + emits event
// - resume() flips state + resolves awaiter with the approver's value
// - resume() on a non-awaiting row returns {ok:false} (race protection)
// - cancelWaiter() clears a dangling resolver
// - listPending() reads from the repo
//
// Also exercises StageRunStateMachine `awaiting_input` transitions.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { createDB, migrateDB, EntryRepository, RegisterRepository } from '@generatorai/db';
import { HitlService } from '../src/services/HitlService.js';
import { DurableExecutionEngine } from '../src/services/DurableExecutionEngine.js';
import { EventBus } from '../src/events/EventBus.js';
import { StageRunStateMachine } from '../src/domain/state-machines/StageRunStateMachine.js';
import type { IStageRunRepository } from '../src/domain/ports/IStageRunRepository.js';
import type { StageRun } from '@generatorai/shared';

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

const quiet = { debug() {}, info() {}, warn() {}, error() {} } as never;

/** Every HITL wait is a durable Awakeable (P01 WP-1.3) — back it with a real engine. */
function makeEngine(): DurableExecutionEngine {
  const db = createDB(':memory:');
  migrateDB(db);
  return new DurableExecutionEngine(new RegisterRepository(db), new EntryRepository(db), quiet);
}

function createMemoryRepo(initial: StageRun[] = []): IStageRunRepository & {
  rows: Map<string, StageRun>;
} {
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

describe('HitlService (HITL-01..05)', () => {
  it('interrupt() persists awaiting_input + data and emits stage_run.awaiting_input', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    const bus = new EventBus();
    const seen: Array<{ kind: string; data: unknown }> = [];
    bus.subscribeGlobal((e) => seen.push({ kind: e.kind, data: e.data }));

    const svc = new HitlService(repo, bus, makeEngine());
    // Don't await yet — interrupt returns a pending promise until resume.
    const pending = svc.interrupt('s1', 'wr1', { toolCall: 'shell.exec', args: { cmd: 'ls' } }, { prompt: 'Allow ls?' });
    // Event bus is async — give it a tick.
    await new Promise((r) => setTimeout(r, 20));

    expect(repo.rows.get('s1')!.status).toBe('awaiting_input');
    expect(repo.rows.get('s1')!.interruptData).toMatchObject({ toolCall: 'shell.exec', args: { cmd: 'ls' } });
    const evt = seen.find((e) => e.kind === 'stage_run.awaiting_input');
    expect(evt).toBeDefined();
    expect((evt!.data as { prompt?: string }).prompt).toBe('Allow ls?');

    // Resolve the awaiter so the promise above doesn't leak.
    await svc.resume('s1', 'wr1', { outcome: 'approved' });
    await pending; // ensure it resolves
  });

  it('resume() flips state, resolves awaiter with value, emits stage_run.input_received', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    const bus = new EventBus();
    const seen: Array<{ kind: string; data: unknown }> = [];
    bus.subscribeGlobal((e) => seen.push({ kind: e.kind, data: e.data }));

    const svc = new HitlService(repo, bus, makeEngine());
    const pending = svc.interrupt('s1', 'wr1', {});

    const result = await svc.resume('s1', 'wr1', {
      outcome: 'approved',
      value: { choice: 'proceed' },
    });
    expect(result.ok).toBe(true);
    expect(repo.rows.get('s1')!.status).toBe('running');
    // Wait for global emit + resolved promise.
    const resolution = await pending;
    expect(resolution.outcome).toBe('approved');
    expect(resolution.value).toEqual({ choice: 'proceed' });

    // Event visible.
    await new Promise((r) => setTimeout(r, 10));
    const recv = seen.find((e) => e.kind === 'stage_run.input_received');
    expect(recv).toBeDefined();
  });

  it('resume() on a non-awaiting stage returns {ok:false}', async () => {
    const repo = createMemoryRepo([stubStageRun({ status: 'running' })]);
    const svc = new HitlService(repo, new EventBus(), makeEngine());
    const result = await svc.resume('s1', 'wr1', { outcome: 'approved' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not awaiting_input');
  });

  it('second resume loses the race', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    const svc = new HitlService(repo, new EventBus(), makeEngine());
    const pending = svc.interrupt('s1', 'wr1', {});
    const first = await svc.resume('s1', 'wr1', { outcome: 'approved' });
    const second = await svc.resume('s1', 'wr1', { outcome: 'changes_requested' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    await pending; // resolved by first
  });

  it('cancelWaiter rejects an awaiting interrupt with a reason', async () => {
    const repo = createMemoryRepo([stubStageRun()]);
    const svc = new HitlService(repo, new EventBus(), makeEngine());
    const pending = svc.interrupt('s1', 'wr1', {});
    svc.cancelWaiter('s1', 'parent run cancelled');
    const res = await pending;
    expect(res.outcome).toBe('rejected');
    expect(res.reason).toBe('parent run cancelled');
    expect(svc.activeWaiterCount).toBe(0);
  });

  it('listPending reads from findAwaitingInputByRun', async () => {
    const repo = createMemoryRepo([
      stubStageRun({ id: 'a', status: 'awaiting_input', interruptData: { q: 1 } }),
      stubStageRun({ id: 'b', status: 'running' }),
      stubStageRun({ id: 'c', workflowRunId: 'other', status: 'awaiting_input' }),
    ]);
    const svc = new HitlService(repo, new EventBus(), makeEngine());
    const pending = await svc.listPending('wr1');
    expect(pending.map((s) => s.id)).toEqual(['a']);
  });
});

describe('StageRunStateMachine — awaiting_input (HITL-01)', () => {
  it('running → awaiting_input via sys:input_request', () => {
    const sm = new StageRunStateMachine('running');
    expect(sm.transition('sys:input_request')).toBe('awaiting_input');
  });

  it('awaiting_input → running via sys:input_received', () => {
    const sm = new StageRunStateMachine('awaiting_input');
    expect(sm.transition('sys:input_received')).toBe('running');
  });

  it('awaiting_input → cancelled via user:cancel or sys:parent_cancel', () => {
    const a = new StageRunStateMachine('awaiting_input');
    expect(a.transition('user:cancel')).toBe('cancelled');
    const b = new StageRunStateMachine('awaiting_input');
    expect(b.transition('sys:parent_cancel')).toBe('cancelled');
  });

  it('awaiting_input is not terminal, not active', () => {
    const sm = new StageRunStateMachine('awaiting_input');
    expect(sm.isTerminal).toBe(false);
    expect(sm.isActive).toBe(false);
  });

  it('cannot sys:input_request from a non-running state', () => {
    const sm = new StageRunStateMachine('queued');
    expect(() => sm.transition('sys:input_request')).toThrow();
  });

  it('cannot sys:input_received from a non-awaiting state', () => {
    const sm = new StageRunStateMachine('running');
    expect(() => sm.transition('sys:input_received')).toThrow();
  });
});

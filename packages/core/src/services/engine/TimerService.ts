// ────────────────────────────────────────────────────────────────
// TimerService — the in-process clock over `workflow_timers` (P03 WP-3.6,
// G5 §5.7).
//
// `RunStore.apply` persists every timer a decision batch arms (retry,
// queue_timeout, pause_ttl, run_budget_wall_clock, and the P05 kinds) with a
// concrete `fire_at`; this service holds one in-memory timer per live row
// of the runs this process owns, loads them again at boot, and fires each
// with a CAS (`fired_at IS NULL AND cancelled_at IS NULL`) before posting
// `timer_fired` to the run's actor. A cancelled or already-fired row loses
// the CAS, so a stale in-memory timer is harmless. Delays over 2^31-1 ms
// are chained.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { IWorkflowTimerStore } from '../../domain/ports/IEngineStore.js';
import type { RunMessage, TimerKind } from '../../domain/scheduler/types.js';

/** Node clamps a longer `setTimeout` to ~1 ms. */
const MAX_DELAY_MS = 2_147_483_647;

export interface ScheduledTimer {
  id: string;
  workflowRunId: string;
  stageRunId: string | null;
  kind: TimerKind;
  fireAt: number;
}

export interface TimerServiceDeps {
  timers: IWorkflowTimerStore;
  post: (runId: string, msg: RunMessage) => void;
  now?: () => number;
  logger?: ILogger | undefined;
}

export class TimerService {
  private readonly handles = new Map<string, { runId: string; handle: ReturnType<typeof setTimeout> }>();
  private readonly now: () => number;
  private stopped = false;

  constructor(private readonly deps: TimerServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Schedule a timer the store armed (a new arm of the same id replaces the old handle). */
  arm(t: ScheduledTimer): void {
    if (this.stopped) return;
    this.clear(t.id);
    const schedule = (): void => {
      const remaining = t.fireAt - this.now();
      const handle = setTimeout(
        () => {
          if (t.fireAt - this.now() > 0) return schedule();
          this.handles.delete(t.id);
          this.fire(t);
        },
        Math.max(0, Math.min(remaining, MAX_DELAY_MS)),
      );
      handle.unref?.();
      this.handles.set(t.id, { runId: t.workflowRunId, handle });
    };
    schedule();
  }

  /** Re-arm every live timer of a run (boot recovery, a run taken over). */
  loadRun(runId: string): number {
    const rows = this.deps.timers.listLive(runId);
    for (const r of rows) this.arm(r);
    return rows.length;
  }

  /** Drop the in-memory handles of a run (terminal, or no longer owned). */
  forgetRun(runId: string): void {
    for (const [id, h] of this.handles) {
      if (h.runId !== runId) continue;
      clearTimeout(h.handle);
      this.handles.delete(id);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const h of this.handles.values()) clearTimeout(h.handle);
    this.handles.clear();
  }

  get size(): number {
    return this.handles.size;
  }

  private clear(id: string): void {
    const h = this.handles.get(id);
    if (h) {
      clearTimeout(h.handle);
      this.handles.delete(id);
    }
  }

  private fire(t: ScheduledTimer): void {
    try {
      if (!this.deps.timers.fire(t.id, this.now())) return; // cancelled, or fired elsewhere
    } catch (err) {
      this.deps.logger?.error(`[TimerService] firing ${t.kind} timer ${t.id} failed: ${String(err)}`);
      return;
    }
    this.deps.post(t.workflowRunId, { type: 'timer_fired', timerId: t.id, kind: t.kind, stageRunId: t.stageRunId });
  }
}

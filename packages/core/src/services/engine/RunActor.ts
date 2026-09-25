// ────────────────────────────────────────────────────────────────
// RunActor — the serial mailbox of one run (P03 WP-3.6, G5 §5.2).
//
//   load → decide → apply(ownerEpoch) → dispatch
//
// Messages (commands, attempt outcomes, usage, timers, lease expiries,
// lifecycle results, ticks) are processed strictly one at a time. `process`
// is synchronous: one read of the run's state, the pure `decide()`, one
// fenced transaction (`RunStore.apply`). It never awaits a harness call, a
// validation or a sleep, so a slow stage cannot stall its siblings (B-1).
// A lost CAS (an executor-owned write raced the actor) re-reads and
// re-decides, up to three times; `fenced` means another owner took the run
// and this actor retires. Effects are dispatched only after the commit.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import type { ILogger } from '@generatorai/shared';
import type { ApplyResult, IRunStore } from '../../domain/ports/IRunStore.js';
import { decide } from '../../domain/scheduler/decide.js';
import type { Decision, RunMessage, RunState } from '../../domain/scheduler/types.js';
import type { CompiledWorkflow } from '../../domain/workflow-graph/compile.js';

export type ProcessResult =
  | { ok: true; decisions: Decision[]; rejected?: { code: string; message: string } }
  | { ok: false; reason: 'fenced' | 'conflict' | 'missing' | 'retired'; detail: string };

/** One processed message, as a replay fixture records it (G5 §7.3). */
export interface DecideRecord {
  runId: string;
  state: RunState;
  message: RunMessage;
  now: number;
  decisions: Decision[];
}

export interface RunActorDeps {
  runId: string;
  ownerEpoch: number;
  compiled: CompiledWorkflow;
  store: IRunStore;
  /** After the commit: timers, outbox, launches, aborts, deliveries, lifecycle. */
  dispatch: (runId: string, res: Extract<ApplyResult, { ok: true }>) => void;
  onFenced: (runId: string) => void;
  onTerminal: (runId: string) => void;
  now?: () => number;
  random?: () => number;
  logger?: ILogger | undefined;
  /** Every committed batch (replay fixtures, tests). */
  onDecide?: ((r: DecideRecord) => void) | undefined;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const MAX_CONFLICT_RETRIES = 3;

/** A stable hash of the state `decide()` read (journalled with the batch). */
export function stateHash(state: RunState): string {
  const ordered = { run: state.run, instances: [...state.instances].sort((a, b) => (a.id < b.id ? -1 : 1)) };
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex').slice(0, 16);
}

export class RunActor {
  private readonly queue: Array<{ msg: RunMessage; resolve: (r: ProcessResult) => void }> = [];
  private draining = false;
  private retired = false;
  private readonly now: () => number;

  constructor(private readonly deps: RunActorDeps) {
    this.now = deps.now ?? Date.now;
  }

  get runId(): string {
    return this.deps.runId;
  }

  get epoch(): number {
    return this.deps.ownerEpoch;
  }

  get isRetired(): boolean {
    return this.retired;
  }

  /** Enqueue a message; resolves once it was processed (commands read the reply from it). */
  post(msg: RunMessage): Promise<ProcessResult> {
    return new Promise((resolve) => {
      if (this.retired) return resolve({ ok: false, reason: 'retired', detail: `the actor of ${this.deps.runId} retired` });
      this.queue.push({ msg, resolve });
      this.drain();
    });
  }

  retire(): void {
    this.retired = true;
    for (const e of this.queue.splice(0)) e.resolve({ ok: false, reason: 'retired', detail: `the actor of ${this.deps.runId} retired` });
  }

  private drain(): void {
    if (this.draining) return; // a post from inside a dispatch joins the running loop
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.retired) {
        const e = this.queue.shift()!;
        let r: ProcessResult;
        try {
          r = this.process(e.msg);
        } catch (err) {
          this.deps.logger?.error(`[RunActor] ${this.deps.runId}: processing ${e.msg.type} threw: ${String(err)}`);
          r = { ok: false, reason: 'conflict', detail: String(err) };
        }
        e.resolve(r);
      }
    } finally {
      this.draining = false;
    }
  }

  private process(msg: RunMessage): ProcessResult {
    const { store, runId, compiled } = this.deps;
    for (let i = 0; i < MAX_CONFLICT_RETRIES; i++) {
      const state = store.loadRunState(runId);
      if (!state) return { ok: false, reason: 'missing', detail: `run ${runId} does not exist` };
      const now = this.now();
      const decisions = decide(compiled, state, msg, now);
      if (decisions.length === 0) return { ok: true, decisions };
      const reject = decisions[0]!.t === 'reject' ? (decisions[0] as Extract<Decision, { t: 'reject' }>) : undefined;
      if (reject) return { ok: true, decisions, rejected: { code: reject.code, message: reject.message } };

      const res = store.apply(runId, this.deps.ownerEpoch, decisions, {
        now,
        ...(this.deps.random ? { random: this.deps.random } : {}),
        message: msg,
        stateHash: stateHash(state),
      });
      if (res.ok) {
        this.deps.onDecide?.({ runId, state, message: msg, now, decisions });
        this.deps.dispatch(runId, res);
        const terminal = decisions.some((d) => d.t === 'run_transition' && TERMINAL.has(d.to));
        if (terminal) this.deps.onTerminal(runId);
        return { ok: true, decisions };
      }
      if (res.reason === 'fenced') {
        this.retire();
        this.deps.onFenced(runId);
        return { ok: false, reason: 'fenced', detail: res.detail };
      }
      // conflict: an executor-owned CAS won; re-read and re-decide.
    }
    this.deps.logger?.error(`[RunActor] ${runId}: persistent CAS conflict on ${msg.type}; a tick retries`);
    const t = setTimeout(() => void this.post({ type: 'tick' }), 50);
    t.unref?.();
    return { ok: false, reason: 'conflict', detail: 'persistent CAS conflict' };
  }
}

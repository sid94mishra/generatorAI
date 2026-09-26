// ────────────────────────────────────────────────────────────────
// AdmissionController — the flow keys (P05 §1.2, P07 WP-7.2, W-66).
//
// Named concurrency caps. A workflow stage launch is admitted on its flow
// keys ONLY — this is the engine's single gate:
//   global               every stage of every run (default: sized from the
//                        machine, 2..16);
//   provider:<id>        every turn on a provider — chats included: the
//                        provider's own per-turn permit IS this gate (the
//                        formerly hidden claude-agent cap of 4, O-2);
//   model:<id>           optional, only when configured;
//   check:global         the `check` stages of every run (default 2).
// A launch takes all of its keys at once or waits for all of them (no
// partial holds, so a stage waiting on its provider never sits on a
// `global` slot another provider's stage could use). The limits are
// operator settings (`setFlowLimits`), changed at run time. The
// `worktree:<mountId>` leases (WorktreeLeases) and `run:<id>` (a run's
// `maxParallel`, enforced by `decide()`) are reported beside them.
//
// Queueing
// --------
// Waiters are granted in FIFO order, but only a FULL key holds a waiter
// back: a waiter blocked on `global` does not reserve its `provider:` key,
// so a chat turn (which needs only `provider:<id>`) is never refused while
// that provider has room. An attended per-turn permit (`priority`, a chat)
// is queued ahead of every stage launch, so a person never waits behind a
// backlog of unattended fan-out. A waiter can be withdrawn (`signal`): a
// cancelled launch or a stopped chat leaves the queue at once.
//
// Parking across long waits
// -------------------------
// A stage that blocks on a human can sit there for hours. Its ticket's
// `pause()` gives its keys back across the wait and `resume()` queues for
// them again; a gate INSIDE a turn keeps its provider key (`keep`), since
// the provider's process lives on while the gate waits.
// ────────────────────────────────────────────────────────────────

import * as os from 'node:os';

/**
 * Handle given to an admitted task so it can yield its flow keys across an
 * external wait (human approval, hook backoff) instead of holding them.
 */
export interface AdmissionTicket {
  /** The flow keys the task was admitted on. */
  readonly keys: readonly string[];
  /** Whether the task holds `key` right now. */
  holds(key: string): boolean;
  /** Give the keys back, except `keep`. Idempotent. */
  pause(opts?: { keep?: readonly string[] }): void;
  /** Take the given-back keys again, queueing if one is full; rejects when `signal` aborts. Idempotent. */
  resume(signal?: AbortSignal): Promise<void>;
}

export interface AdmissionControllerConfig {
  /**
   * Flow key limits over `defaultFlowLimits()` (P07 WP-7.2): the operator's
   * settings. A key with no limit (an unconfigured `model:` or `provider:`)
   * is not gated.
   */
  flowLimits?: Record<string, number>;
  /** Structured logger. INFO on queue. */
  logger?: {
    info?: (msg: string, meta?: Record<string, unknown>) => void;
    warn?: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

/**
 * The default `global` limit, sized from the machine: one stage per CPU and
 * per 512 MB of memory, at least 2 and at most 16 (each agent stage may be
 * a provider CLI process of a few hundred MB).
 */
export function sizeGlobalFlowLimit(
  probe: { cpus: number; totalMemBytes: number } = { cpus: os.cpus().length || 1, totalMemBytes: os.totalmem() },
): number {
  const cpuBound = Math.max(1, probe.cpus);
  const memoryBound = Math.max(1, Math.floor(probe.totalMemBytes / (512 * 1024 * 1024)));
  return Math.min(16, Math.max(2, Math.min(cpuBound, memoryBound)));
}

/** The flow key of every stage launch. */
export const GLOBAL_FLOW_KEY = 'global';
/** The flow key of the `check` kind (P05 §1.2). */
export const CHECK_FLOW_KEY = 'check:global';
/** The flow key of a provider's turns. */
export function providerFlowKey(provider: string): string {
  return `provider:${provider}`;
}
/** The flow key of a model's turns (gated only when configured). */
export function modelFlowKey(model: string): string {
  return `model:${model}`;
}

/** The highest limit any flow key accepts. */
export const MAX_FLOW_LIMIT = 256;

/**
 * The default flow limits (P07 WP-7.2): `global` is sized from the machine,
 * `provider:claude-agent` is 4 (each turn is a ~250 MB CLI process),
 * `check:global` is 2 (P05 §1.2).
 */
export function defaultFlowLimits(probe?: { cpus: number; totalMemBytes: number }): Record<string, number> {
  return {
    [GLOBAL_FLOW_KEY]: sizeGlobalFlowLimit(probe),
    [providerFlowKey('claude-agent')]: 4,
    [CHECK_FLOW_KEY]: 2,
  };
}

/** A flow key's live state. */
export interface FlowState {
  flowKey: string;
  running: number;
  /** Callers waiting for this key (one waiter may wait on several keys). */
  queued: number;
  /** Undefined: not gated. */
  limit: number | undefined;
}

/**
 * One flow key as a plain permit gate: what a provider's per-turn permit
 * uses (the AgentHostSupervisor, the agent host client), so a chat turn and
 * a stage launch count against the same `provider:<id>` limit. Its waits
 * are attended (a person sent the turn): they queue ahead of stage launches.
 */
export interface FlowGate {
  readonly flowKey: string;
  /** A permit only if one is free right now (never waits). */
  tryAcquire(): (() => void) | undefined;
  /** Wait for a permit; rejects (an `AbortError`) when `signal` aborts first. */
  acquire(signal?: AbortSignal): Promise<() => void>;
  state(): FlowState;
}

/** Told when a caller has to wait: the first key that is full. */
export type FlowQueuedListener = (blocking: FlowState) => void;

export interface FlowAcquireOptions {
  onQueued?: FlowQueuedListener | undefined;
  /** Withdraws the waiter: it leaves the queue and the wait rejects with an `AbortError`. */
  signal?: AbortSignal | undefined;
  /** An attended per-turn permit (a chat turn): queued ahead of every non-priority waiter. */
  priority?: boolean | undefined;
}

interface FlowWaiter {
  keys: readonly string[];
  priority: boolean;
  grant: () => void;
}

function abortError(): Error {
  const err = new Error('The admission wait was withdrawn');
  err.name = 'AbortError';
  return err;
}

export class AdmissionController {
  private readonly logger: AdmissionControllerConfig['logger'];
  private readonly flowRunning = new Map<string, number>();
  private readonly flowWaiters: FlowWaiter[] = [];
  private readonly flowDefaults: Record<string, number>;
  private flowLimits: Record<string, number>;

  constructor(cfg: AdmissionControllerConfig = {}) {
    this.logger = cfg.logger;
    this.flowDefaults = defaultFlowLimits();
    this.flowLimits = { ...this.flowDefaults, ...clampFlowLimits(cfg.flowLimits ?? {}) };
    this.logger?.info?.('[Admission] flow limits', { ...this.flowLimits });
  }

  /** The default limits (what "reset to default" restores). */
  defaultFlowLimits(): Record<string, number> {
    return { ...this.flowDefaults };
  }

  /** The limits in force: the defaults under the operator's settings. */
  currentFlowLimits(): Record<string, number> {
    return { ...this.flowLimits };
  }

  /**
   * Replace the operator's limits (over the defaults), at run time. A
   * raised limit admits waiters at once; a lowered one lets the holders
   * finish and admits nobody until they are under it.
   */
  setFlowLimits(limits: Record<string, number>): void {
    this.flowLimits = { ...this.flowDefaults, ...clampFlowLimits(limits) };
    this.logger?.info?.('[Admission] flow limits set', { ...this.flowLimits });
    this.pumpFlows();
  }

  private flowLimit(key: string): number | undefined {
    return this.flowLimits[key];
  }

  private flowState(key: string): FlowState {
    return {
      flowKey: key,
      running: this.flowRunning.get(key) ?? 0,
      queued: this.flowWaiters.filter((w) => w.keys.includes(key)).length,
      limit: this.flowLimit(key),
    };
  }

  private hasRoom(key: string): boolean {
    const limit = this.flowLimit(key);
    return limit === undefined || (this.flowRunning.get(key) ?? 0) < limit;
  }

  private take(keys: readonly string[]): void {
    for (const k of keys) this.flowRunning.set(k, (this.flowRunning.get(k) ?? 0) + 1);
  }

  private untake(keys: readonly string[]): void {
    for (const k of keys) {
      const n = (this.flowRunning.get(k) ?? 1) - 1;
      if (n <= 0) this.flowRunning.delete(k);
      else this.flowRunning.set(k, n);
    }
    this.pumpFlows();
  }

  /**
   * Admit waiters in queue order (priority waiters first): a waiter is
   * granted when every one of its keys has room. Only a full key holds a
   * waiter back — a waiter never reserves the keys it is not blocked on.
   */
  private pumpFlows(): void {
    for (let i = 0; i < this.flowWaiters.length; ) {
      const w = this.flowWaiters[i]!;
      if (!w.keys.every((k) => this.hasRoom(k))) {
        i += 1;
        continue;
      }
      this.flowWaiters.splice(i, 1);
      this.take(w.keys);
      w.grant();
    }
  }

  /** Wait until every key has room, then take them all. */
  private waitFlows(keys: readonly string[], opts: FlowAcquireOptions = {}): Promise<void> {
    if (opts.signal?.aborted) return Promise.reject(abortError());
    if (keys.every((k) => this.hasRoom(k))) {
      this.take(keys);
      return Promise.resolve();
    }
    const blocking = keys.find((k) => !this.hasRoom(k))!;
    return new Promise<void>((resolve, reject) => {
      const signal = opts.signal;
      const onAbort = (): void => {
        const at = this.flowWaiters.indexOf(waiter);
        if (at < 0) return; // granted already
        this.flowWaiters.splice(at, 1);
        reject(abortError());
      };
      const waiter: FlowWaiter = {
        keys,
        priority: opts.priority === true,
        grant: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
      };
      // A priority waiter goes after the priority waiters already queued, ahead of the rest.
      const at = waiter.priority ? this.flowWaiters.findIndex((w) => !w.priority) : -1;
      if (at >= 0) this.flowWaiters.splice(at, 0, waiter);
      else this.flowWaiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
      opts.onQueued?.(this.flowState(blocking));
      this.logger?.info?.('[Admission] queued on flow keys', { keys, blocking, priority: waiter.priority });
    });
  }

  /**
   * Take every key at once, waiting until all have room. Duplicate keys
   * count once. Resolves to the release function (idempotent).
   */
  async acquireFlows(flowKeys: readonly string[], opts: FlowAcquireOptions = {}): Promise<() => void> {
    const keys = [...new Set(flowKeys)];
    await this.waitFlows(keys, opts);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.untake(keys);
    };
  }

  /**
   * Run `fn` holding every flow key (see `acquireFlows`). The ticket yields
   * the keys across an external wait (all, or all but `keep`) and takes
   * them back.
   */
  async admitFlows<T>(flowKeys: readonly string[], fn: (ticket: AdmissionTicket) => Promise<T>, opts: FlowAcquireOptions = {}): Promise<T> {
    const keys = [...new Set(flowKeys)];
    await this.waitFlows(keys, opts);
    const held = new Set(keys);
    let done = false;
    let resuming: Promise<void> | undefined;
    const stopResume = new AbortController();
    const ticket: AdmissionTicket = {
      keys,
      holds: (key) => held.has(key),
      pause: (p = {}) => {
        const give = [...held].filter((k) => !p.keep?.includes(k));
        if (give.length === 0) return;
        for (const k of give) held.delete(k);
        this.untake(give);
      },
      resume: (signal) => {
        if (resuming) return resuming;
        const missing = keys.filter((k) => !held.has(k));
        if (missing.length === 0 || done) return Promise.resolve();
        const both = signal ? AbortSignal.any([signal, stopResume.signal]) : stopResume.signal;
        resuming = this.waitFlows(missing, { signal: both }).then(
          () => {
            resuming = undefined;
            if (done) return this.untake(missing);
            for (const k of missing) held.add(k);
          },
          (err: unknown) => {
            resuming = undefined;
            throw err;
          },
        );
        return resuming;
      },
    };
    try {
      return await fn(ticket);
    } finally {
      done = true;
      stopResume.abort();
      if (held.size > 0) this.untake([...held]);
      held.clear();
    }
  }

  /** One flow key as a permit gate (a provider's per-turn permit; attended, so priority). */
  flowGate(flowKey: string): FlowGate {
    return {
      flowKey,
      tryAcquire: () => {
        if (!this.hasRoom(flowKey)) return undefined;
        this.take([flowKey]);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          this.untake([flowKey]);
        };
      },
      acquire: (signal) => this.acquireFlows([flowKey], { priority: true, signal }),
      state: () => this.flowState(flowKey),
    };
  }

  /** Every configured key and every key in use: running, queued, limit. */
  flowSnapshot(): FlowState[] {
    const keys = new Set<string>([...Object.keys(this.flowLimits), ...this.flowRunning.keys(), ...this.flowWaiters.flatMap((w) => w.keys)]);
    return [...keys].sort().map((k) => this.flowState(k));
  }
}

/** Operator limits clamped to 1..MAX_FLOW_LIMIT; a non-number is dropped. */
function clampFlowLimits(limits: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(limits)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[k] = Math.min(MAX_FLOW_LIMIT, Math.max(1, Math.floor(v)));
  }
  return out;
}

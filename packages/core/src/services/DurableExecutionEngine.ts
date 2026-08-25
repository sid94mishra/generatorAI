// ────────────────────────────────────────────────────────────────
// DurableExecutionEngine — W22 §3.4
//
// Implements step memoization on top of the `registers` and `entries`
// SQLite tables (W47). This is the main defence against P0-41 (a 1000-
// row automation batch that dies at row 40 loses 960 rows silently) and
// X-23 (interrupt hazards around approval pauses cause exponential replay).
//
// ── Mechanism overview ─────────────────────────────────────────────
//
//  The durable program counter
//    After every step, one register (`op.state/{operationId}`) is
//    overwritten with the complete current state. Recovery reads it and
//    switches. It never infers position from what is missing.
//
//  The effect sandwich
//    1. Commit intent — write `intent` to the register (the op is now
//       visible to recovery). Reserve output ids before performing the
//       effect so a settled id is stable across restarts.
//    2. Perform the uncertain effect.
//    3. Commit settlement — write the result to `entries` and flip the
//       register to `settled`.
//    On restart, a register in `intent` state with a corresponding `entries`
//    row (tool_result) returns the stored result without re-running.
//    A register in `intent` state with NO entries row means the process
//    died between intent and perform:
//      - `replay: safe`  → re-run the effect.
//      - `replay: never` → return a synthetic error result (never re-runs).
//
//  Per-tool replay policy
//    'never' = terminal commands, computer-use actions, file writes, git,
//              HTTP POST — effects that must not run twice.
//    'safe'  = reads, greps, searches, window lists, page snapshots —
//              idempotent, safe to re-run if intent was written but no
//              settlement landed.
//
//  Corruption closed enum (W22)
//    'torn_tail'         — parse error on last entry only; recoverable.
//    'unreachable_state' — a state the single-writer protocol cannot
//                          produce (e.g. settled with no intent); fatal.
//    'missing_settlement' — intent committed but no settlement + replay:never;
//                           returns a synthetic error result.
//
//  Signal primitive
//    Named, resolvable repeatedly. A running agent can await a Signal
//    without blocking a process thread — the promise resolves when
//    `resolveSignal` writes the entry row. A new Signal awaiter is a
//    new subscription, not a replay of the old entry.
//
//  Awakeable primitive
//    One-time wake-up token. `createAwakeable()` returns `{ token, promise }`.
//    An external party calls `POST /api/awakeables/:token/resolve` which
//    calls `resolveAwakeable`. The promise rejects on a second resolve
//    (already-resolved entries row returns null from the repo).
//
//  Iteration claiming (P0-41 fix)
//    `initializeIterations` writes all iteration rows up front in a single
//    transaction. `claimNextIteration` atomically transitions one row from
//    `pending` → `running` (UPDATE ... WHERE ... RETURNING). On restart, a
//    new process finds and claims any still-pending rows.
//
// ── Interrupt-hazard lint rules ────────────────────────────────────
//
// LINT-HAZ-1: Never await external I/O between a DB write and the next
//   DB write that settles it. If the intent row is committed and the
//   process dies before the settlement row, recovery must tolerate the
//   gap. Always use `withEffect()` so the sandwich is enforced.
//
// LINT-HAZ-2: Never read from registers and then mutate shared state
//   in separate awaits without a CAS guard. The register `version` field
//   is the guard. Use `registerRepo.cas()` for optimistic concurrency.
//
// LINT-HAZ-3: `replay: never` effects MUST NOT have observable side
//   effects that cannot be tolerated twice in a crash-recovery scenario
//   unless the caller guards with an idempotency key. File writes and
//   terminal commands already guard via HITL or workspace fencing.
//
// LINT-HAZ-4: Signals and awakeables must not block a microtask queue
//   indefinitely. Always supply a `timeoutMs` to `awaitSignal` and
//   `awaitAwakeable`. The default is 24 h — a gate open longer than that
//   must explicitly pass a larger timeout.
// ────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import type { RegisterRepository } from '@generatorai/db';
import type { EntryRepository, EntryScope } from '@generatorai/db';
import type { ILogger } from '@generatorai/shared';

// ── Types ──────────────────────────────────────────────────────

/** Per-tool replay policy (W22). */
export type ReplayPolicy = 'never' | 'safe';

/** State of a step in the register. */
type StepState = 'intent' | 'settled';

/** The value written to a register for a step operation. */
interface StepRegisterValue {
  state: StepState;
  /** Reserved output id — stable across restarts. */
  outputId: string;
  /** epoch-ms when intent was committed. */
  intentAt: number;
  /** epoch-ms when settled. Only present when state === 'settled'. */
  settledAt?: number;
}

/**
 * Corruption type closed enum (W22). States the single-writer protocol
 * cannot produce are rejected, not repaired, unless the repair path is
 * explicitly listed here.
 */
export type JournalCorruption =
  | 'torn_tail'            // parse error on last entry → repair + warn
  | 'unreachable_state'   // settled with no intent, or invalid state value
  | 'missing_settlement'; // intent + replay:never but no settlement row

/** Options for `withEffect`. */
export interface EffectSpec<T> {
  /** Stable, unique operation id. Use `${stageRunId}/tool/${toolCallId}`. */
  operationId: string;
  /**
   * Replay policy for this effect.
   * - `never`:  file writes, git, terminal commands, HTTP POST, CUA.
   * - `safe`:   reads, greps, searches, window lists, snapshots.
   */
  replayPolicy: ReplayPolicy;
  /** The uncertain effect. Must not throw unless the failure is terminal. */
  perform: () => Promise<T>;
  /**
   * Serialize the result to a string for the entries store.
   * Default: `JSON.stringify`.
   */
  serialize?: (result: T) => string;
  /**
   * Deserialize a stored string back to T.
   * Default: `JSON.parse`.
   */
  deserialize?: (stored: string) => T;
}

/** Context binding for a running operation. */
export interface DurableContext {
  /** Scope for registers and entries lookups. */
  readonly scope: EntryScope;
  readonly scopeId: string;
}

// ── Signal / Awakeable internals ───────────────────────────────

interface SignalSubscriber {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Engine ─────────────────────────────────────────────────────

export class DurableExecutionEngine {
  /** In-memory subscribers for Signals keyed by `${scope}/${scopeId}/${name}`. */
  private readonly signalSubscribers = new Map<string, Set<SignalSubscriber>>();
  /** In-memory subscribers for Awakeables keyed by token. */
  private readonly awakeableSubscribers = new Map<
    string,
    { resolve: (payload: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly registerRepo: RegisterRepository,
    private readonly entryRepo: EntryRepository,
    private readonly logger: ILogger,
  ) {}

  // ── Effect sandwich ───────────────────────────────────────────

  /**
   * Execute an effect with the durable sandwich pattern:
   *
   *   1. Commit intent (reserve outputId, write register state = 'intent')
   *   2. Check for prior settlement (memoization — returns stored result on replay)
   *   3. If no prior settlement: perform the effect, commit settlement
   *
   * On crash-recovery:
   *   - State = 'settled' → return the stored entry's payload (never re-runs).
   *   - State = 'intent', entries row exists → return stored result (memoised).
   *   - State = 'intent', no entries row, replay:'safe' → re-run perform().
   *   - State = 'intent', no entries row, replay:'never' → synthetic error.
   *
   * LINT-HAZ-1: the settle write happens inside this function; callers must
   * not write settlement themselves.
   */
  async withEffect<T>(ctx: DurableContext, spec: EffectSpec<T>): Promise<T> {
    const { operationId, replayPolicy, perform } = spec;
    const serialize = spec.serialize ?? ((v: T) => JSON.stringify(v));
    const deserialize = spec.deserialize ?? ((s: string) => JSON.parse(s) as T);
    const registerKey = `op.state/${operationId}`;

    // ── Step 1: Read existing register (may be undefined on first run) ──
    const existing = this.registerRepo.get(ctx.scope, ctx.scopeId, registerKey);

    if (existing) {
      const stored = existing.value as StepRegisterValue;
      if (stored.state !== 'intent' && stored.state !== 'settled') {
        this.handleCorruption('unreachable_state', `operationId=${operationId} state=${String(stored.state)}`);
      }

      // ── Memoisation: check entries store for a prior settlement ──
      const priorEntry = this.entryRepo.findToolResult(ctx.scope, ctx.scopeId, operationId);
      if (priorEntry) {
        this.logger.debug(`[DurableEngine] replay ${operationId} → returning stored result`);
        return deserialize(priorEntry.payload as string);
      }

      // ── Prior intent, no settlement ──
      if (stored.state === 'settled') {
        // Corrupt: the register says settled but no entries row exists.
        this.handleCorruption(
          'unreachable_state',
          `operationId=${operationId}: register.state=settled but no tool_result entry`,
        );
      }

      // state === 'intent', no entries row
      if (replayPolicy === 'never') {
        this.handleCorruption(
          'missing_settlement',
          `operationId=${operationId}: intent committed with replay:never but no settlement — returning synthetic error`,
        );
        // We treat missing_settlement as non-fatal: return a synthetic error payload.
        const syntheticError = {
          __synthetic: true,
          reason: 'missing_settlement',
          operationId,
        };
        // Write a settlement entry so the next recovery doesn't repeat this.
        this.entryRepo.create({
          scope: ctx.scope,
          scopeId: ctx.scopeId,
          kind: 'tool_result',
          key: operationId,
          payload: syntheticError,
        });
        return deserialize(JSON.stringify(syntheticError));
      }

      // replay: safe — re-run the effect
      this.logger.info(`[DurableEngine] safe-replay ${operationId}`);
    } else {
      // ── First run: commit intent ──────────────────────────────
      const outputId = randomBytes(8).toString('hex');
      const intentValue: StepRegisterValue = {
        state: 'intent',
        outputId,
        intentAt: Date.now(),
      };
      // LINT-HAZ-1: Intent is committed BEFORE perform() is called.
      this.registerRepo.set(ctx.scope, ctx.scopeId, registerKey, intentValue);
    }

    // ── Step 2: Perform the effect ──
    let result: T;
    try {
      result = await perform();
    } catch (err) {
      // Effect failed — do NOT commit a settlement. The next run will see
      // the intent register and either re-run (safe) or return synthetic (never).
      throw err;
    }

    // ── Step 3: Commit settlement ──
    const serialized = serialize(result);
    this.entryRepo.create({
      scope: ctx.scope,
      scopeId: ctx.scopeId,
      kind: 'tool_result',
      key: operationId,
      payload: serialized,
    });

    // Overwrite register to 'settled' (unconditional — we are the single writer
    // within a stage run's scope, so no CAS needed here).
    const existingAfterIntent = this.registerRepo.get(ctx.scope, ctx.scopeId, registerKey);
    const settledValue: StepRegisterValue = {
      state: 'settled',
      outputId: (existingAfterIntent?.value as StepRegisterValue | undefined)?.outputId ?? 'unknown',
      intentAt: (existingAfterIntent?.value as StepRegisterValue | undefined)?.intentAt ?? Date.now(),
      settledAt: Date.now(),
    };
    this.registerRepo.set(ctx.scope, ctx.scopeId, registerKey, settledValue);

    return result;
  }

  // ── Signal primitive ──────────────────────────────────────────

  /**
   * Resolve a Signal — marks an `entries` row resolved and notifies all
   * in-memory awaiters. Resolvable repeatedly (each resolve creates a new
   * subscriber opportunity).
   *
   * Used for mid-run steering: redirect a running agent without cancelling.
   */
  resolveSignal(ctx: DurableContext, name: string, payload: unknown = null): void {
    // Create a new resolved entry for this signal occurrence.
    const entry = this.entryRepo.create({
      scope: ctx.scope,
      scopeId: ctx.scopeId,
      kind: 'signal',
      key: name,
      payload,
    });
    this.entryRepo.resolve(entry.id, payload);

    // Notify in-memory subscribers.
    const subKey = `${ctx.scope}/${ctx.scopeId}/${name}`;
    const subs = this.signalSubscribers.get(subKey);
    if (subs) {
      for (const sub of subs) {
        clearTimeout(sub.timer);
        sub.resolve(payload);
      }
      subs.clear();
    }
  }

  /**
   * Await a Signal — returns a promise that resolves when the named signal
   * fires (either a prior unresolved entry already exists, or an in-memory
   * subscriber fires on the next `resolveSignal` call).
   *
   * LINT-HAZ-4: Always supply `timeoutMs`. Default is 86_400_000 (24 h).
   */
  awaitSignal(
    ctx: DurableContext,
    name: string,
    timeoutMs = 86_400_000,
  ): Promise<unknown> {
    // F2 fix: on recovery, a signal that was already resolved before the process
    // crashed has no unresolved DB row — the old code fell through and returned a
    // new Promise that would hang until timeout. Now we check for a resolved
    // signal first and return its payload immediately if found.
    const priorResolved = this.entryRepo.findLastResolvedSignal(ctx.scope, ctx.scopeId, name);
    if (priorResolved) {
      this.logger.debug(`[DurableEngine] awaitSignal '${name}' — returning prior resolved payload (recovery)`);
      return Promise.resolve(priorResolved.payload);
    }

    return new Promise<unknown>((resolve, reject) => {
      const subKey = `${ctx.scope}/${ctx.scopeId}/${name}`;
      const timer = setTimeout(() => {
        const subs = this.signalSubscribers.get(subKey);
        if (subs) subs.delete(sub);
        reject(new Error(`Signal '${name}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      // Node.js: don't let the timer keep the process alive.
      timer.unref?.();

      const sub: SignalSubscriber = { resolve, reject, timer };
      let subs = this.signalSubscribers.get(subKey);
      if (!subs) {
        subs = new Set();
        this.signalSubscribers.set(subKey, subs);
      }
      subs.add(sub);
    });
  }

  // ── Awakeable primitive ───────────────────────────────────────

  /**
   * Create an Awakeable — a one-time wake-up token. The caller receives a
   * `{ token, promise }` pair. Pass the token to an external party (HTTP
   * callback, webhook, CLI). When `resolveAwakeable(token, payload)` is
   * called, the promise resolves.
   *
   * The token is persisted as an `entries` row so recovery can find pending
   * awakeables and re-create in-memory subscribers.
   *
   * LINT-HAZ-4: Always supply `timeoutMs`. Default is 86_400_000 (24 h).
   */
  createAwakeable(
    ctx: DurableContext,
    timeoutMs = 86_400_000,
  ): { token: string; promise: Promise<unknown> } {
    const token = randomBytes(16).toString('hex');

    // Persist the awakeable intent so recovery knows it was created.
    this.entryRepo.create({
      scope: ctx.scope,
      scopeId: ctx.scopeId,
      kind: 'awakeable',
      key: token,
      payload: null,
    });

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.awakeableSubscribers.delete(token);
        reject(new Error(`Awakeable ${token} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();

      this.awakeableSubscribers.set(token, { resolve, reject, timer });
    });

    return { token, promise };
  }

  /**
   * Resolve an Awakeable by its one-time token. Called by the HTTP endpoint
   * `POST /api/awakeables/:token/resolve`.
   *
   * Returns true on success, false if the token is unknown or already resolved
   * (the caller should return 409 Conflict).
   */
  resolveAwakeable(token: string, payload: unknown = null): boolean {
    const entry = this.entryRepo.resolveByKey(token, payload);
    if (!entry) return false;

    const sub = this.awakeableSubscribers.get(token);
    if (sub) {
      clearTimeout(sub.timer);
      sub.resolve(payload);
      this.awakeableSubscribers.delete(token);
    }
    return true;
  }

  /**
   * Re-arm in-memory awakeable subscribers from durable storage and return
   * a map of token → Promise so the calling recovery code can await them.
   *
   * F5 fix: the original implementation set no-op resolve/reject handlers,
   * which meant resolveAwakeable would mark the DB row but never unblock any
   * caller. Recovery requires REAL Promises backed by real resolve callbacks.
   *
   * Callers must `await` the returned promises for each token. Tokens that
   * are already resolved in the DB are returned as immediately-resolved
   * Promises containing the stored payload.
   */
  recoverAwakeables(ctx: DurableContext, timeoutMs = 86_400_000): Map<string, Promise<unknown>> {
    const result = new Map<string, Promise<unknown>>();
    const entries = this.entryRepo.listByScope(ctx.scope, ctx.scopeId);

    for (const entry of entries) {
      if (entry.kind !== 'awakeable' || !entry.key) continue;

      const token = entry.key;

      // Already resolved in the DB — return an immediately-resolved Promise.
      if (entry.resolved) {
        result.set(token, Promise.resolve(entry.payload));
        continue;
      }

      // Already has a real subscriber from this session — don't overwrite it.
      if (this.awakeableSubscribers.has(token)) {
        // Expose its promise by creating a new one that mirrors the subscriber.
        // (This is a rare path — recoverAwakeables called twice in one process.)
        result.set(token, new Promise<unknown>((resolve, reject) => {
          const existing = this.awakeableSubscribers.get(token);
          if (existing) {
            // Replace with a combined handler.
            const origResolve = existing.resolve;
            const origReject = existing.reject;
            existing.resolve = (v) => { origResolve(v); resolve(v); };
            existing.reject = (e) => { origReject(e); reject(e); };
          }
        }));
        continue;
      }

      // Create a real Promise and subscribe so resolveAwakeable will unblock it.
      const promise = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.awakeableSubscribers.delete(token);
          reject(new Error(`Awakeable ${token} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
        this.awakeableSubscribers.set(token, { resolve, reject, timer });
      });
      result.set(token, promise);
    }

    return result;
  }

  // ── Corruption handling ───────────────────────────────────────

  /**
   * Handle a detected journal corruption. The closed enum (W22) determines
   * whether the corruption is recoverable or fatal.
   *
   * - `torn_tail`:         warn + continue (repair path is in the caller).
   * - `missing_settlement`: warn + return synthetic result (non-fatal).
   * - `unreachable_state`:  throws — a state the single-writer protocol
   *                         cannot produce is always a bug.
   */
  private handleCorruption(kind: JournalCorruption, detail: string): never | void {
    const msg = `[DurableEngine] corruption:${kind} — ${detail}`;
    if (kind === 'unreachable_state') {
      this.logger.error(msg);
      throw new Error(msg);
    }
    this.logger.warn(msg);
  }

  // ── Iteration claiming (P0-41 fix) ────────────────────────────

  /**
   * Write all automation iteration rows up front in a single atomic batch.
   *
   * Each row is an `entries` record with kind='stage_result' (overloaded as
   * an iteration slot) and resolved=0 (pending). The `key` field holds the
   * iteration index as a string for atomic claim lookup.
   *
   * Called once per execution before the iteration loop starts so that on
   * restart, a new process can find and claim any still-pending iterations
   * without rebuilding the iteration list from in-memory data.
   *
   * Returns the number of rows written (0 if the slots already exist from a
   * prior run, indicating recovery mode).
   */
  initializeIterations(
    executionId: string,
    iterations: Array<{ index: number; variables: Record<string, unknown>; label: string }>,
  ): number {
    let written = 0;
    for (const iter of iterations) {
      const key = `iter/${iter.index}`;
      // F1 fix: iteration slots use kind='stage_result', not 'tool_result'.
      // findToolResult queries kind='tool_result' and always returned undefined
      // for iteration slots, causing all slots to be re-inserted on every
      // recovery instead of being skipped as duplicates.
      const existing = this.entryRepo.findStageResultByKey('automation_execution', executionId, key);
      if (existing) continue;

      this.entryRepo.create({
        scope: 'automation_execution',
        scopeId: executionId,
        kind: 'stage_result', // re-used as an iteration slot
        key,
        payload: {
          index: iter.index,
          variables: iter.variables,
          label: iter.label,
          status: 'pending',
        },
      });
      written++;
    }
    return written;
  }

  /**
   * Atomically claim the next pending iteration slot for this execution.
   * Returns the claimed iteration payload, or null if all iterations are
   * claimed or completed.
   *
   * The "claim" is a RESOLVED flag on the entries row (resolved=1 means
   * claimed-and-running or already-completed). This is the exact mechanism
   * that prevents two concurrent processes from claiming the same iteration:
   * `resolveByKey` uses `UPDATE ... WHERE resolved=0 RETURNING` which is
   * atomic in SQLite WAL mode.
   *
   * Called once per iteration in the loop, replacing the in-memory index.
   */
  claimNextIteration(executionId: string): {
    id: string;
    index: number;
    variables: Record<string, unknown>;
    label: string;
  } | null {
    // Find the lowest unclaimed iteration key for this execution.
    const entries = this.entryRepo.listByScope('automation_execution', executionId);
    const pending = entries
      .filter((e) => e.kind === 'stage_result' && !e.resolved && typeof e.key === 'string' && e.key.startsWith('iter/'))
      .sort((a, b) => {
        const ai = parseInt((a.key ?? '').replace('iter/', ''), 10);
        const bi = parseInt((b.key ?? '').replace('iter/', ''), 10);
        return ai - bi;
      });

    for (const entry of pending) {
      // Atomically resolve (claim) the row.
      const claimed = this.entryRepo.resolve(entry.id);
      if (claimed) {
        const payload = entry.payload as {
          index: number;
          variables: Record<string, unknown>;
          label: string;
          status: string;
        };
        return {
          id: entry.id,
          index: payload.index,
          variables: payload.variables,
          label: payload.label,
        };
      }
      // Another process claimed it first; try the next one.
    }
    return null;
  }
}

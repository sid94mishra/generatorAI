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
//                          produce (an unrecognised register state value);
//                          fatal.
//    'missing_settlement' — the register names an operation whose settlement
//                           row is absent: either intent was committed and
//                           the process died before settling, or the row was
//                           settled and later pruned. Recoverable — replay
//                           policy decides (safe → re-run, never → synthetic
//                           error result).
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
//    `pending` → `running` (UPDATE ... WHERE ... RETURNING) and stamps a
//    LEASE (owner + claimedAt) into its payload. `completeIteration` writes
//    the outcome back. `reclaimExpiredIterations` hands back any slot still
//    marked `running` whose lease has expired — the signature of a process
//    that died mid-iteration. Without the lease and the completion write, a
//    claimed row was indistinguishable from a finished one and its work was
//    lost permanently and silently (P0-c), which defeated the whole point of
//    the mechanism.
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
import type { ArtifactRecord, EntryRepository, EntryScope } from '@generatorai/db';
import type { AgentToolPolicy, ILogger } from '@generatorai/shared';

// ── Types ──────────────────────────────────────────────────────

/** Per-tool replay policy (W22). */
export type ReplayPolicy = 'never' | 'safe';

// ── Per-tool replay policy declarations (W22 §3.4) ─────────────
//
// §3.4: "`never` = terminal commands, computer-use actions, file writes, git,
// HTTP POST. `safe` = reads, greps, searches, window lists, page snapshots."
//
// The type existed from the start but NOTHING declared a policy, so the whole
// mechanism was unreachable: `withEffect` could only ever be called with a
// policy its caller invented on the spot. This table is the declaration the
// plan asked for, and `replayPolicyForToolGroups` below is what folds it into
// the one decision the stage turn path can actually make (see
// `StageExecutor.turn` — a turn is the coarsest unit we can
// journal, because the individual tool calls happen inside the provider SDK
// and never cross our process boundary).
//
// △ The default is `never`, not `safe`. A tool nobody has classified is a tool
// whose side effects nobody has thought about; guessing `safe` for it would
// re-run an unknown mutation after every crash. Fail closed.

/**
 * Tools that are genuinely idempotent — re-running one after a crash observes
 * state, it does not change it. Everything absent from this set is `never`.
 */
const REPLAY_SAFE_TOOLS: ReadonlySet<string> = new Set([
  // Integrated Browser — observation only.
  'read_page',
  'screenshot_page',
  // Computer use — the reader half of the reader/writer split (W17).
  'computer_snapshot',
  'computer_capabilities',
  'computer_list_apps',
  'computer_list_windows',
  'computer_verify',
  // Widgets — inspection only.
  'read_widget',
  'describe_widget',
  'search_widget',
  'list_widgets',
  // Orchestration — digest collection does not spawn or steer anything.
  'check_background_agent',
  'check_background_agents',
  'list_background_agents',
  'list_available_agents',
  'list_models',
  // Provider built-ins.
  'Read',
  'NotebookRead',
  'Grep',
  'Glob',
  'LS',
  'WebFetch',
  'WebSearch',
]);

/**
 * Replay policy for one tool, by the name the provider reports on
 * `harness.tool_start`. Unknown tools are `never` (fail closed).
 */
export function replayPolicyForTool(toolName: string): ReplayPolicy {
  return REPLAY_SAFE_TOOLS.has(toolName) ? 'safe' : 'never';
}

/**
 * Which tool groups can only ever hand the model replay-safe tools.
 *
 * Keyed off `AgentToolPolicy` because that is the only tool-surface
 * description available BEFORE a turn runs — and the replay policy has to be
 * chosen before the effect, not after it. `fileRead` and `web` are the two
 * groups whose entire membership is in `REPLAY_SAFE_TOOLS`; every other group
 * contains at least one mutation (browser clicks, widget renders, extension
 * writes, worker spawns, file writes, shell).
 */
const REPLAY_SAFE_TOOL_GROUPS: ReadonlySet<keyof AgentToolPolicy> = new Set<keyof AgentToolPolicy>([
  'fileRead',
  'web',
]);

/**
 * Fold a stage's enabled tool groups into the replay policy for one agent
 * turn: `safe` only when EVERY enabled group is replay-safe, otherwise
 * `never`.
 *
 * This is what makes a read-only analysis stage cheap to resume — its
 * interrupted turn simply re-runs — while a stage that could have written a
 * file or run a command does not silently redo that work after a crash.
 */
export function replayPolicyForToolGroups(groups: Partial<AgentToolPolicy> | undefined): ReplayPolicy {
  if (!groups) return 'never';
  for (const [group, enabled] of Object.entries(groups) as Array<[keyof AgentToolPolicy, boolean]>) {
    if (!enabled) continue;
    if (!REPLAY_SAFE_TOOL_GROUPS.has(group)) return 'never';
  }
  return 'safe';
}

/**
 * Shape `withEffect` writes when a `replay: never` effect had committed intent
 * but no settlement — i.e. the process died while the effect was in flight.
 * Exported so callers can recognise the stand-in rather than mistaking it for
 * a real result.
 */
export interface SyntheticEffectResult {
  __synthetic: true;
  reason: 'missing_settlement';
  operationId: string;
}

/** Type guard for the synthetic stand-in above. */
export function isSyntheticEffectResult(value: unknown): value is SyntheticEffectResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __synthetic?: unknown }).__synthetic === true
  );
}

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

/**
 * Zero-padded so the entries table's lexicographic `key` sort — the only
 * order `findNextPendingIteration` has, since it's a plain `ORDER BY key ASC`
 * against an indexed TEXT column — actually matches numeric iteration order.
 *
 * △ Fixed during end-to-end review — `iter/${index}` (unpadded) sorts
 * `iter/10` before `iter/2` under SQLite's default TEXT collation, so any
 * batch past 10 iterations claimed slots out of order: 0, 1, 10, 11, ..., 19,
 * 2, 20, ... — silently breaking W22's "kill mid-batch at row 40, resume at
 * row 41" acceptance guarantee for every batch large enough to matter. 10
 * digits comfortably exceeds any realistic automation iteration count.
 */
function iterationKey(index: number): string {
  return `iter/${String(index).padStart(10, '0')}`;
}

// ── Signal / Awakeable internals ───────────────────────────────

/**
 * Node's `setTimeout` delay is a 32-bit signed int internally — a delay
 * above this silently CLAMPS TO 1ms rather than throwing (verified: Node
 * logs a `TimeoutOverflowWarning` and fires almost immediately). LINT-HAZ-4
 * explicitly tells callers needing a longer-than-24h gate to "explicitly
 * pass a larger timeout," which is exactly the footgun this constant and
 * `armTimer` below exist to close — an approval meant to stay open for 30
 * days would otherwise fire (and reject the caller's promise) within the
 * same tick it was created, with no error, no warning surfaced to the
 * caller. Found via `HitlServiceDurable.test.ts` overriding the HITL
 * default to 30 days.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647; // 2^31 - 1

/**
 * `setTimeout` that tolerates delays beyond `MAX_TIMER_DELAY_MS` by
 * chaining timers instead of overflowing. Returns a handle exposing the
 * same `unref()`/clear surface every call site here already needs.
 */
function armTimer(callback: () => void, delayMs: number): { clear: () => void; unref: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  let shouldUnref = false;
  const schedule = (remaining: number) => {
    const step = Math.min(remaining, MAX_TIMER_DELAY_MS);
    handle = setTimeout(() => {
      const left = remaining - step;
      if (left > 0) schedule(left);
      else callback();
    }, step);
    if (shouldUnref) handle.unref?.();
  };
  schedule(Math.max(delayMs, 0));
  return {
    clear: () => clearTimeout(handle),
    unref: () => {
      shouldUnref = true;
      handle?.unref?.();
    },
  };
}

interface SignalSubscriber {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof armTimer>;
}

// ── Iteration slots (P0-c) ─────────────────────────────────────

/** Lifecycle of one durable automation-iteration slot. */
export type IterationSlotStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Payload stored on an iteration slot's `entries` row. */
export interface IterationSlotPayload {
  index: number;
  variables: Record<string, unknown>;
  label: string;
  status: IterationSlotStatus;
  /** epoch-ms the current claim was taken. Absent while pending. */
  claimedAt?: number;
  /** Which process holds the lease — operator triage only, never a guard. */
  owner?: string;
  /** epoch-ms the slot reached a terminal status. */
  completedAt?: number;
  /** How many times this slot has been handed back after a lease expiry. */
  reclaimCount?: number;
  /** Failure detail, when `status === 'failed'`. */
  error?: string;
}

/** A claimed slot, as handed to the iteration loop. */
export interface ClaimedIteration {
  /** `entries.id` — the handle `completeIteration` needs. */
  id: string;
  index: number;
  variables: Record<string, unknown>;
  label: string;
}

/**
 * How long a claim is honoured before a recovery pass may hand the slot back.
 *
 * Deliberately generous: `AutomationService` allows a single iteration's
 * workflow run up to 2 h, so anything shorter would let a recovery pass steal
 * a slot that is genuinely still running in another live process. Boot
 * recovery does not depend on this value — it knows which iterations still
 * have live workflow runs and passes `leaseMs: 0` for the rest, which is a
 * far better liveness signal than any wall-clock guess.
 */
export const DEFAULT_ITERATION_LEASE_MS = 4 * 60 * 60 * 1000;

// ── Engine ─────────────────────────────────────────────────────

export class DurableExecutionEngine {
  /** In-memory subscribers for Signals keyed by `${scope}/${scopeId}/${name}`. */
  private readonly signalSubscribers = new Map<string, Set<SignalSubscriber>>();
  /** In-memory subscribers for Awakeables keyed by token. */
  private readonly awakeableSubscribers = new Map<
    string,
    { resolve: (payload: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof armTimer> }
  >();
  /**
   * Identifies this engine instance on iteration leases. Diagnostics only —
   * reclaim decides on the lease deadline, never on the owner string, because
   * a restarted process cannot tell which owners are still alive.
   */
  private readonly ownerId = `${process.pid}-${randomBytes(4).toString('hex')}`;

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

      // ── The register names this operation but no settlement row exists ──
      //
      // △ This used to raise `unreachable_state` — a THROW — for
      // `state === 'settled'`, on the reasoning that the single-writer
      // protocol cannot produce it. It can: `entries` rows are prunable
      // (`deleteByScope` on workspace teardown, and retention generally)
      // while `registers` rows are not, so a settled operation whose
      // settlement has been reclaimed lands here on the next replay. Throwing
      // turned an ordinary retention outcome into a fatal stage failure. Both
      // shapes — never-settled and settled-then-pruned — mean the same thing
      // to the caller ("no stored result"), so both take the replay policy
      // below.
      if (stored.state === 'settled') {
        this.handleCorruption(
          'missing_settlement',
          `operationId=${operationId}: register.state=settled but the tool_result entry is absent (pruned, or never written)`,
        );
      }

      // No stored result — replay policy decides.
      if (replayPolicy === 'never') {
        this.handleCorruption(
          'missing_settlement',
          `operationId=${operationId}: intent committed with replay:never but no settlement — returning synthetic error`,
        );
        // We treat missing_settlement as non-fatal: return a synthetic error payload.
        const syntheticError: SyntheticEffectResult = {
          __synthetic: true,
          reason: 'missing_settlement',
          operationId,
        };
        // Write a settlement entry so the next recovery doesn't repeat this.
        //
        // △ `payload` must be the SERIALIZED string, not the raw object —
        // `EntryRepository.create()` itself does one level of
        // `JSON.stringify(payload)` before writing, and `findToolResult()`
        // does one level of `JSON.parse()` back on read. That round trip is
        // transparent for a pre-serialized string (the settlement path's
        // `serialize(result)` above), but passing a raw object here meant a
        // THIRD call for the same operationId (the memoization path,
        // `deserialize(priorEntry.payload as string)`) received the
        // ALREADY-PARSED-BACK object instead of a string and threw
        // `"[object Object]" is not valid JSON` — caught by
        // `DurableExecutionEnginePrimitives.test.ts`.
        const syntheticSerialized = JSON.stringify(syntheticError);
        this.entryRepo.create({
          scope: ctx.scope,
          scopeId: ctx.scopeId,
          kind: 'tool_result',
          key: operationId,
          payload: syntheticSerialized,
        });
        return deserialize(syntheticSerialized);
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
    //
    // §3.4 requires the two settlement writes — the `tool_result` entry and
    // the register flip to `settled` — to be ONE atomic write. Un-transacted,
    // a crash between them left the register in `intent` with a settlement
    // row present: harmless for `replay: safe` but a permanent lie for
    // `replay: never`, which reports `missing_settlement` for an effect that
    // demonstrably completed. Both repositories share one better-sqlite3
    // connection, so `entryRepo.transaction()` covers the register write too.
    const serialized = serialize(result);
    try {
      this.entryRepo.transaction(() => {
        this.entryRepo.create({
          scope: ctx.scope,
          scopeId: ctx.scopeId,
          kind: 'tool_result',
          key: operationId,
          payload: serialized,
        });

        // Overwrite register to 'settled' (unconditional — we are the single
        // writer within a stage run's scope, so no CAS needed here).
        const existingAfterIntent = this.registerRepo.get(ctx.scope, ctx.scopeId, registerKey);
        const settledValue: StepRegisterValue = {
          state: 'settled',
          outputId: (existingAfterIntent?.value as StepRegisterValue | undefined)?.outputId ?? 'unknown',
          intentAt: (existingAfterIntent?.value as StepRegisterValue | undefined)?.intentAt ?? Date.now(),
          settledAt: Date.now(),
        };
        this.registerRepo.set(ctx.scope, ctx.scopeId, registerKey, settledValue);
      });
    } catch (err) {
      // Migration 42 makes (scope, scope_id, key) unique for `tool_result`, so
      // a concurrent writer that settled the same operationId first turns this
      // into a constraint failure. That writer's result IS the settlement —
      // adopt it rather than failing the effect we already performed.
      const settledByOther = this.entryRepo.findToolResult(ctx.scope, ctx.scopeId, operationId);
      if (!settledByOther) throw err;
      this.logger.warn(
        `[DurableEngine] settlement for ${operationId} lost the race; adopting the stored result`,
      );
      return deserialize(settledByOther.payload as string);
    }

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
        sub.timer.clear();
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
      const timer = armTimer(() => {
        const subs = this.signalSubscribers.get(subKey);
        if (subs) subs.delete(sub);
        reject(new Error(`Signal '${name}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      // Node.js: don't let the timer keep the process alive.
      timer.unref();

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
      const timer = armTimer(() => {
        this.awakeableSubscribers.delete(token);
        reject(new Error(`Awakeable ${token} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();

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
      sub.timer.clear();
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
        // MINOR-5 fix: add a new listener alongside the existing one rather
        // than mutating the live callbacks, which could race with an in-flight
        // resolveAwakeable() call and leave the replacement Promise dangling.
        //
        // We create a fresh Promise whose resolve/reject are appended to
        // the existing subscriber's callback lists. If resolveAwakeable fires
        // before this block runs, the subscriber is already gone (deleted from
        // awakeableSubscribers) and we fall through to the DB-resolved branch
        // above — so the ONLY case this branch handles is a concurrent live
        // subscriber, where the new callbacks fire atomically alongside it.
        result.set(token, new Promise<unknown>((resolve, reject) => {
          const existing = this.awakeableSubscribers.get(token);
          if (!existing) {
            // Subscriber was resolved between the has() check and here.
            // Fall back to the DB for the settled value.
            const settled = this.entryRepo.getById(token);
            if (settled?.resolved) {
              resolve(settled.payload);
            } else {
              reject(new Error(`Awakeable ${token} disappeared during recovery`));
            }
            return;
          }
          // Append rather than replace — originals fire too.
          const prevResolve = existing.resolve;
          const prevReject = existing.reject;
          existing.resolve = (v) => { prevResolve(v); resolve(v); };
          existing.reject = (e) => { prevReject(e); reject(e); };
        }));
        continue;
      }

      // Create a real Promise and subscribe so resolveAwakeable will unblock it.
      const promise = new Promise<unknown>((resolve, reject) => {
        const timer = armTimer(() => {
          this.awakeableSubscribers.delete(token);
          reject(new Error(`Awakeable ${token} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref();
        this.awakeableSubscribers.set(token, { resolve, reject, timer });
      });
      result.set(token, promise);
    }

    return result;
  }

  // ── Artifact channel (X-25 / W23) ─────────────────────────────

  /**
   * Append a chunk to a durable artifact in this scope, creating it on the
   * first call and sealing it when `last` is set.
   *
   * §X-25: stage results used to live only in `messages` — the lossy chat
   * stream — while `entries.kind='artifact'`, the store W23 designated for
   * exactly this, had no writers at all. Routing results through here gives
   * them a stable id that survives a retry, append semantics a streaming
   * producer can actually use, and a lifetime that is not tied to the chat
   * session.
   *
   * Returns null when the artifact was already sealed.
   */
  appendArtifact(
    ctx: DurableContext,
    artifactId: string,
    chunk: string,
    opts: { last?: boolean; meta?: Record<string, unknown> } = {},
  ): ArtifactRecord | null {
    const result = this.entryRepo.appendArtifact({
      scope: ctx.scope,
      scopeId: ctx.scopeId,
      artifactId,
      chunk,
      ...(opts.last !== undefined ? { last: opts.last } : {}),
      ...(opts.meta ? { meta: opts.meta } : {}),
    });
    if (!result && chunk.length > 0) {
      // A dropped chunk is DATA LOSS on the channel successors read, and every
      // call site discarded this null, so it happened invisibly. It is still
      // not thrown — the append is best-effort by design — but it must never
      // be silent again.
      this.logger.warn(
        `[DurableEngine] appendArtifact dropped ${chunk.length} char(s) for ` +
        `${ctx.scope}/${ctx.scopeId}/${artifactId}: the artifact is sealed. ` +
        `Reopen it with reopenArtifact() before a new attempt writes to it.`,
      );
    }
    return result;
  }

  /**
   * Take the seal off an artifact so a new attempt on the same scope can keep
   * appending to it. Returns the reopened record, or null when there was
   * nothing sealed to reopen.
   *
   * `last: true` marks "this attempt is finished", but the artifact's scope is
   * the stage RUN, and a run executes again under the same id whenever a
   * post-completion validation retry or a crash relaunch happens. Reopening at
   * the top of each attempt is what keeps the sealed-and-then-resumed case
   * from serving successors the output that was just rejected.
   */
  reopenArtifact(ctx: DurableContext, artifactId: string): ArtifactRecord | null {
    return this.entryRepo.reopenArtifact(ctx.scope, ctx.scopeId, artifactId);
  }

  // ── Retraction ────────────────────────────────────────────────

  /**
   * Forget one operation's journal state so the next `withEffect` for the same
   * id runs LIVE instead of replaying or short-circuiting.
   *
   * This is the deliberate counterpart to memoisation, and it exists for one
   * situation: the caller KNOWS the operation did not complete and knows what
   * to do about it. A pause aborts an in-flight turn mid-response; the resume
   * path then sends a *different* instruction ("continue from where you left
   * off"), which is a new effect that happens to occupy the same slot. Without
   * a retraction the register still says `intent`, so `withEffect` on a
   * `replay: never` stage writes a synthetic settlement, the continuation is
   * skipped, and the stage completes on a truncated answer — durably, so every
   * later resume replays the skip.
   *
   * △ Only ever call this when the incompleteness is KNOWN. Crash recovery
   * does NOT know, which is exactly why it must keep going through the replay
   * policy instead.
   */
  discardOperation(ctx: DurableContext, operationId: string): void {
    this.entryRepo.transaction(() => {
      this.entryRepo.deleteByKey(ctx.scope, ctx.scopeId, 'tool_result', operationId);
      this.registerRepo.delete(ctx.scope, ctx.scopeId, `op.state/${operationId}`);
    });
  }

  /** Read one durable artifact, or undefined when it was never opened. */
  getArtifact(ctx: DurableContext, artifactId: string): ArtifactRecord | undefined {
    return this.entryRepo.getArtifact(ctx.scope, ctx.scopeId, artifactId);
  }

  /** W23 `lastChunk` — the tail of an artifact without re-reading the whole. */
  lastChunk(ctx: DurableContext, artifactId: string): string | undefined {
    return this.entryRepo.lastChunk(ctx.scope, ctx.scopeId, artifactId);
  }

  /** Every artifact in a scope, in creation order. */
  listArtifacts(ctx: DurableContext): ArtifactRecord[] {
    return this.entryRepo.listArtifacts(ctx.scope, ctx.scopeId);
  }

  // ── Retention (§3.4 "retention that fires") ───────────────────

  /**
   * Drop the whole durable journal for one scope — every `entries` row and
   * every `registers` row.
   *
   * §3.4 lists "retention that fires" as part of the persistence engine, but
   * `deleteByScope` existed on both repositories with **zero production
   * callers**: a journal was written for every stage run and every automation
   * execution and then kept forever, so the two hottest tables in the file
   * grew without bound for the lifetime of the deployment.
   *
   * Call this only once the scope is TERMINAL. While a scope is live its
   * journal is the thing that makes re-entry cheap, and a retry gets a fresh
   * operation-id epoch rather than reusing a released one.
   *
   * △ Both deletes run in ONE transaction. Dropping `entries` while leaving
   * `registers` behind is precisely the `missing_settlement` shape
   * `withEffect` has to tolerate above — recoverable, but it turns every
   * subsequent read of that scope into a corruption warning for no reason.
   */
  releaseScope(ctx: DurableContext): void {
    this.entryRepo.transaction(() => {
      this.entryRepo.deleteByScope(ctx.scope, ctx.scopeId);
      this.registerRepo.deleteByScope(ctx.scope, ctx.scopeId);
    });
  }

  /**
   * Retention for a scope that has FINISHED but whose result must outlive it:
   * drops the step journal (one register + one `tool_result` per turn, which
   * is what actually grows without bound) and keeps the artifacts, which are
   * the stage's durable output (X-25) and are read after it completes.
   *
   * This is the variant for a scope's terminal transition. `releaseScope` above is the full teardown for a scope that is
   * being deleted outright.
   */
  releaseJournal(ctx: DurableContext): void {
    this.entryRepo.transaction(() => {
      this.entryRepo.deleteJournalByScope(ctx.scope, ctx.scopeId);
      this.registerRepo.deleteByScope(ctx.scope, ctx.scopeId);
    });
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
    // F1 fix: iteration slots use kind='stage_result', not 'tool_result'.
    // findToolResult queries kind='tool_result' and always returned undefined
    // for iteration slots, causing all slots to be re-inserted on every
    // recovery instead of being skipped as duplicates.
    //
    // P0-41 / atomicity fix: collect all NEW slots first, then insert them in
    // a single SQLite transaction via createBatch(). This prevents a partial
    // write (crash mid-loop) from leaving some slots missing, and is ~10x
    // faster for large automations because it avoids per-row statement overhead.
    const newSlots: Array<Parameters<typeof this.entryRepo.createBatch>[0][number]> = [];

    for (const iter of iterations) {
      const key = iterationKey(iter.index);
      const existing = this.entryRepo.findStageResultByKey('automation_execution', executionId, key);
      if (existing) continue; // recovery mode — slot already committed
      newSlots.push({
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
    }

    if (newSlots.length > 0) {
      this.entryRepo.createBatch(newSlots);
    }

    return newSlots.length;
  }

  /**
   * Atomically claim the next pending iteration slot for this execution.
   * Returns the claimed iteration, or null if no slot is unclaimed.
   *
   * The "claim" is a RESOLVED flag on the entries row (resolved=1 means
   * claimed). This is the exact mechanism that prevents two concurrent
   * processes from claiming the same iteration: `resolve` uses
   * `UPDATE ... WHERE resolved=0 RETURNING`, which is atomic in SQLite WAL
   * mode.
   *
   * P0-c — the same UPDATE now also stamps the LEASE (`status: 'running'`,
   * `claimedAt`, `owner`) into the payload, so a slot that was claimed is
   * distinguishable from one that finished. `completeIteration` writes the
   * terminal status; `reclaimExpiredIterations` hands back anything left
   * `running` by a process that died. Previously neither existed: a claim was
   * a one-way door and an interrupted iteration was lost permanently and
   * indistinguishably from a successful one.
   *
   * Called once per iteration in the loop, replacing the in-memory index.
   */
  claimNextIteration(executionId: string): ClaimedIteration | null {
    // MAJOR-3 fix: use a targeted DB query instead of loading all entries.
    // The previous implementation called listByScope() which returned every
    // entry for the execution — O(all_tool_calls) deserialization per claim,
    // giving O(n²) total cost across a full run. findNextPendingIteration()
    // issues a single index-scan query that returns at most one row.
    for (;;) {
      const entry = this.entryRepo.findNextPendingIteration(
        'automation_execution',
        executionId,
      );
      if (!entry) return null;

      const payload = entry.payload as IterationSlotPayload;
      const leased: IterationSlotPayload = {
        ...payload,
        status: 'running',
        claimedAt: Date.now(),
        owner: this.ownerId,
      };

      // Atomically resolve (claim) the row — returns null if another process
      // claimed it between the SELECT and the UPDATE (concurrent multi-process
      // automation). If so, loop and try the next slot.
      const claimed = this.entryRepo.resolve(entry.id, leased);
      if (claimed) {
        return {
          id: entry.id,
          index: payload.index,
          variables: payload.variables,
          label: payload.label,
        };
      }
      // Another process claimed it first — re-query to get the new lowest slot.
    }
  }

  /**
   * P0-c — record the outcome of a claimed iteration. Must be called for
   * every slot `claimNextIteration` handed out, success or failure: it is the
   * ONLY thing that distinguishes "this iteration finished" from "the process
   * holding this slot died", and therefore the only thing that stops recovery
   * re-running work that already completed.
   */
  completeIteration(
    slotId: string,
    status: 'completed' | 'failed',
    error?: string,
  ): void {
    const entry = this.entryRepo.getById(slotId);
    if (!entry) {
      this.logger.warn(`[DurableEngine] completeIteration: slot ${slotId} no longer exists`);
      return;
    }
    const payload = entry.payload as IterationSlotPayload;
    this.entryRepo.updatePayload(slotId, {
      ...payload,
      status,
      completedAt: Date.now(),
      ...(error ? { error } : {}),
    } satisfies IterationSlotPayload);
  }

  /** P0-c — iteration slots nobody has claimed yet. */
  countPendingIterations(executionId: string): number {
    return this.entryRepo.countPendingIterations('automation_execution', executionId);
  }

  /**
   * P0-c — hand back every slot still marked `running` whose lease has
   * expired, so a later `claimNextIteration` re-issues it. This is what makes
   * an iteration that was in flight when the process died recoverable rather
   * than silently lost.
   *
   * `skipIndexes` are iterations the caller knows are genuinely still live
   * (boot recovery passes the ones whose workflow run has not reached a
   * terminal state). Those keep their claim so the work is not started twice
   * while it is still running.
   *
   * Returns the indexes actually handed back.
   */
  reclaimExpiredIterations(
    executionId: string,
    opts: { leaseMs?: number; skipIndexes?: Iterable<number> } = {},
  ): number[] {
    const leaseMs = opts.leaseMs ?? DEFAULT_ITERATION_LEASE_MS;
    const skip = new Set(opts.skipIndexes ?? []);
    const cutoff = Date.now() - leaseMs;
    const reclaimed: number[] = [];

    for (const entry of this.entryRepo.listClaimedIterations('automation_execution', executionId)) {
      const payload = entry.payload as IterationSlotPayload;
      // The row is claimed (that is what `listClaimedIterations` returns), so
      // anything without a terminal status is in flight — including a slot
      // claimed by a build that predates leases, whose payload still reads
      // `pending`. Leaving those claimed forever is the exact permanent loss
      // this pass exists to undo.
      if (payload.status === 'completed' || payload.status === 'failed') continue;
      if (skip.has(payload.index)) continue;
      if (payload.claimedAt !== undefined && payload.claimedAt > cutoff) continue;

      const handedBack = this.entryRepo.unresolve(entry.id, {
        ...payload,
        status: 'pending',
        claimedAt: undefined,
        owner: undefined,
        reclaimCount: (payload.reclaimCount ?? 0) + 1,
      } satisfies IterationSlotPayload);
      if (handedBack) reclaimed.push(payload.index);
    }

    if (reclaimed.length > 0) {
      this.logger.info(
        `[DurableEngine] reclaimed ${reclaimed.length} expired iteration lease(s) for execution ${executionId}`,
      );
    }
    return reclaimed;
  }
}

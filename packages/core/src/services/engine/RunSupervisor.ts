// ────────────────────────────────────────────────────────────────
// RunSupervisor — the v2 engine of one process (P03 WP-3.6, G5 §5.1–5.2,
// §3.10; RV-27).
//
// At boot it takes the SINGLE-ENGINE LOCK (`engine_lock`): a lock whose
// heartbeat is fresher than 30 s belongs to another live process, and the
// engine refuses to start rather than drive that process's runs. It renews
// the lock every 10 s. Every run it hosts is claimed with
// `owner_id = bootId, owner_epoch + 1`, and every decision batch of that run
// is fenced on the epoch, so a stale process can never write to it.
//
// It owns one `RunActor` per active run and routes every message to it:
// commands, attempt outcomes and usage from the executor, timers, lease
// expiries and lifecycle results. The TimerService and the LeaseReaper act
// only on runs this process owns.
//
// RECOVERY (the only run recovery; fixes W-16/W-32/B-10/B-20)
// never completes a stage on missing work. For every started, non-terminal
// run: take it over, then for each attempt that was live when the previous
// process died —
//   - `ready` (admitted, never claimed): launch it again;
//   - in an attempt state: a turn with an intent and no settlement is
//     interrupted (RV-10). A never-replay turn in flight ends the attempt as
//     `interrupted/process_restart_unsafe` → the instance is PAUSED for an
//     operator; otherwise (safe turns only, or every turn settled) it ends as
//     `interrupted/lease_expired` with a safe replay → a resume attempt
//     replays the settled turns from the journal;
//   - `awaiting_input` (its frame died with the process): `frame_lost`. A
//     completion review stays parked (its turns settled) and its approval
//     starts a resume attempt that carries the verdict; a gate inside a
//     turn (tool permission, question, plan review) pauses the instance as
//     `interrupted`, and a resume re-sends the turn;
// then re-arm the run's timers, re-dispatch a lost `prepare`/`finalize`, and
// post a `tick`. Sessions need no rehydration: `run_sessions` is read at
// bind time, after every row above was settled (B-20).
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { ILogger } from '@generatorai/shared';
import type { RunCommand } from '@generatorai/workflow-spec';
import { classified } from '../../domain/errors/StageError.js';
import type { EngineStores } from '../../domain/ports/IEngineStore.js';
import type { IAgentHarness } from '../../domain/ports/IAgentHarness.js';
import type { ISessionRepository } from '../../domain/ports/IRepositories.js';
import type { IScriptRunner } from '../../domain/ports/IScriptRunner.js';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import type { RunMessage, RunOutcome } from '../../domain/scheduler/types.js';
import { compile, type CompiledWorkflow } from '../../domain/workflow-graph/compile.js';
import type { EventBus } from '../../events/EventBus.js';
import type { AdmissionController } from '../AdmissionController.js';
import type { RunDefinitionReader } from '../definitions/RunDefinitionReader.js';
import type { HookExecutor } from '../HookExecutor.js';
import type { PlanService } from '../PlanService.js';
import type { SessionComposer } from '../session/SessionComposer.js';
import type { WorkspaceCheckpointService } from '../WorkspaceCheckpointService.js';
import type { WorkspaceManager } from '../WorkspaceManager.js';
import { EffectsDispatcher } from './EffectsDispatcher.js';
import { inFlightIsSafe, LeaseReaper } from './LeaseReaper.js';
import { OutboxDispatcher, type OutboxPublisher } from './OutboxDispatcher.js';
import { RunActor, type DecideRecord, type ProcessResult } from './RunActor.js';
import { DefaultRunLifecycle, type RunLifecycle, type RunLifecycleDeps } from './RunLifecycle.js';
import { journalEpoch, StageExecutor, type ExecutorTiming, type StageArtifactReader } from './StageExecutor.js';
import { TimerService } from './TimerService.js';

export interface SupervisorTiming {
  /** A lock heartbeat older than this is stale (RV-27: 30 s). */
  lockStaleMs: number;
  /** Lock and run-ownership renewal period (10 s). */
  lockRenewMs: number;
  /** Run ownership lease. */
  ownershipTtlMs: number;
  /** LeaseReaper period (15 s). */
  reaperEveryMs: number;
}

export const DEFAULT_SUPERVISOR_TIMING: SupervisorTiming = {
  lockStaleMs: 30_000,
  lockRenewMs: 10_000,
  ownershipTtlMs: 60_000,
  reaperEveryMs: 15_000,
};

export interface RunSupervisorDeps {
  stores: EngineStores;
  runRepo: IWorkflowRunRepository;
  definitions: RunDefinitionReader;
  harness: IAgentHarness;
  composer: SessionComposer;
  sessionRepo: ISessionRepository;
  eventBus: EventBus;
  workspaceManager: WorkspaceManager;
  /** THE concurrency gate of every stage launch (W-66). */
  admission: AdmissionController;
  hookExecutor?: HookExecutor | undefined;
  checkpoints?: WorkspaceCheckpointService | undefined;
  planService?: PlanService | undefined;
  scriptRunner?: IScriptRunner | undefined;
  toHarnessError?: ((provider: string | undefined, raw: unknown) => unknown) | undefined;
  /** Files uploaded to a stage (the stage conversation API's attachments). */
  artifacts?: StageArtifactReader | undefined;
  /** Where engine events go (default: `eventBus.emitGlobal`, awaited). */
  publish?: OutboxPublisher | undefined;
  /** Prepare/finalize (default: `DefaultRunLifecycle`). */
  lifecycle?: RunLifecycle | undefined;
  /** PD-17 start check of the default lifecycle's `prepare`. */
  permissionCheck?: RunLifecycleDeps['permissionCheck'];
  /** This process's boot id (default: a random UUID). */
  bootId?: string | undefined;
  /** A label for the lock row (host, pid). */
  ownerLabel?: string | undefined;
  logger?: ILogger | undefined;
  now?: () => number;
  random?: () => number;
  timing?: Partial<SupervisorTiming> & { executor?: Partial<ExecutorTiming> };
  onDecide?: ((r: DecideRecord) => void) | undefined;
}

/** The engine did not start: another live process holds the database's engine lock. */
export class EngineLockedError extends Error {
  constructor(readonly holder: { ownerId: string | null; bootId: string | null; heartbeatAt: number | null }) {
    super(
      `Another process owns the workflow engine of this database (owner ${holder.ownerId ?? '?'}, boot ${holder.bootId ?? '?'}, ` +
        `last heartbeat ${holder.heartbeatAt ?? '?'}). The engine was not started.`,
    );
    this.name = 'EngineLockedError';
  }
}

export type CommandResult =
  | { ok: true }
  | { ok: false; code: 'not_found' | 'invalid_state' | 'version_conflict' | 'invalid_command' | 'fenced' | 'conflict' | 'engine_unavailable'; message: string };

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export class RunSupervisor {
  readonly bootId: string;
  readonly executor: StageExecutor;
  readonly timers: TimerService;
  readonly outbox: OutboxDispatcher;
  readonly effects: EffectsDispatcher;
  readonly reaper: LeaseReaper;
  readonly lifecycle: RunLifecycle;
  private readonly actors = new Map<string, Promise<RunActor | null>>();
  private readonly timing: SupervisorTiming;
  private readonly now: () => number;
  private lockTimer: ReturnType<typeof setInterval> | undefined;
  private started = false;
  private stopped = false;

  constructor(private readonly deps: RunSupervisorDeps) {
    this.bootId = deps.bootId ?? randomUUID();
    this.now = deps.now ?? Date.now;
    this.timing = { ...DEFAULT_SUPERVISOR_TIMING, ...(deps.timing ?? {}) };
    const post = (runId: string, msg: RunMessage): void => this.post(runId, msg);
    this.executor = new StageExecutor({
      bootId: this.bootId,
      stores: deps.stores,
      runRepo: deps.runRepo,
      definitions: deps.definitions,
      harness: deps.harness,
      composer: deps.composer,
      sessionRepo: deps.sessionRepo,
      eventBus: deps.eventBus,
      workspaceManager: deps.workspaceManager,
      hookExecutor: deps.hookExecutor,
      checkpoints: deps.checkpoints,
      planService: deps.planService,
      scriptRunner: deps.scriptRunner,
      toHarnessError: deps.toHarnessError,
      artifacts: deps.artifacts,
      post,
      logger: deps.logger,
      now: this.now,
      ...(deps.timing?.executor ? { timing: deps.timing.executor } : {}),
    });
    this.timers = new TimerService({ timers: deps.stores.timers, post, now: this.now, logger: deps.logger });
    this.outbox = new OutboxDispatcher({
      outbox: deps.stores.outbox,
      publish: deps.publish ?? ((e) => deps.eventBus.emitGlobal(e as never)),
      now: this.now,
      logger: deps.logger,
    });
    this.lifecycle =
      deps.lifecycle ??
      new DefaultRunLifecycle({
        stores: deps.stores,
        runRepo: deps.runRepo,
        definitions: deps.definitions,
        workspaceManager: deps.workspaceManager,
        harness: deps.harness,
        sessionRepo: deps.sessionRepo,
        eventBus: deps.eventBus,
        hookExecutor: deps.hookExecutor,
        checkpoints: deps.checkpoints,
        permissionCheck: deps.permissionCheck,
        logger: deps.logger,
        now: this.now,
      });
    this.effects = new EffectsDispatcher({
      executor: this.executor,
      admission: deps.admission,
      timers: this.timers,
      outbox: this.outbox,
      lifecycle: this.lifecycle,
      post,
      logger: deps.logger,
    });
    this.reaper = new LeaseReaper({
      ownerId: this.bootId,
      stores: deps.stores,
      executor: this.executor,
      post,
      now: this.now,
      logger: deps.logger,
      everyMs: this.timing.reaperEveryMs,
    });
  }

  /** The engine's stores (the run facade's CAS for a setup failure before `start`). */
  get stores(): EngineStores {
    return this.deps.stores;
  }

  /** Whether this process hosts the engine (started, not stopped). */
  get running(): boolean {
    return this.started && !this.stopped;
  }

  /** Late wiring: checkpoints are built after the engine (composition root). */
  setCheckpoints(checkpoints: WorkspaceCheckpointService): void {
    this.executor.setCheckpoints(checkpoints);
    if (this.lifecycle instanceof DefaultRunLifecycle) this.lifecycle.setCheckpoints(checkpoints);
  }

  // ── Boot ─────────────────────────────────────────────────────

  /**
   * Take the engine lock, recover, and start the timers and the reaper.
   * Throws `EngineLockedError` when another live process holds the lock.
   */
  async start(): Promise<void> {
    if (this.started) return;
    const { lock } = this.deps.stores;
    if (!lock.acquire(this.deps.ownerLabel ?? `pid:${process.pid}`, this.bootId, this.now(), this.timing.lockStaleMs)) {
      const holder = lock.get() ?? { ownerId: null, bootId: null, heartbeatAt: null };
      this.deps.logger?.error(`[RunSupervisor] ${new EngineLockedError(holder).message}`);
      throw new EngineLockedError(holder);
    }
    this.started = true;
    this.lockTimer = setInterval(() => this.renew(), this.timing.lockRenewMs);
    this.lockTimer.unref?.();
    await this.recover();
    this.reaper.start();
  }

  /** Stop hosting: timers, the reaper and the lock. Frames are left as they are (a restart recovers them). */
  async stop(opts: { releaseLock?: boolean } = {}): Promise<void> {
    this.stopped = true;
    if (this.lockTimer) clearInterval(this.lockTimer);
    this.lockTimer = undefined;
    this.reaper.stop();
    this.timers.stop();
    this.outbox.stop();
    for (const p of this.actors.values()) void p.then((a) => a?.retire());
    this.actors.clear();
    if (opts.releaseLock !== false && this.started) this.deps.stores.lock.release(this.bootId);
  }

  private renew(): void {
    const now = this.now();
    if (!this.deps.stores.lock.renew(this.bootId, now)) {
      this.deps.logger?.error('[RunSupervisor] lost the engine lock; stopping');
      void this.stop({ releaseLock: false });
      return;
    }
    for (const [runId, p] of this.actors) {
      void p.then((a) => {
        if (a && !this.deps.stores.runs.renewOwnership(runId, this.bootId, a.epoch, this.timing.ownershipTtlMs, now)) a.retire();
      });
    }
  }

  // ── Routing ──────────────────────────────────────────────────

  /** Deliver a message to a run's actor (created and the run claimed on first use). */
  post(runId: string, msg: RunMessage): void {
    void this.send(runId, msg);
  }

  private async send(runId: string, msg: RunMessage): Promise<ProcessResult> {
    const actor = await this.actorFor(runId);
    if (!actor) {
      const row = this.deps.stores.runs.getRunRow(runId);
      // A terminal run is never mutated (a re-run is a fork): its commands are refused, not lost.
      if (row && msg.type === 'command') {
        return { ok: true, decisions: [], rejected: { code: 'invalid_state', message: `the run is ${row.status}` } };
      }
      return { ok: false, reason: 'missing', detail: row ? `run ${runId} is ${row.status}` : `run ${runId} does not exist` };
    }
    return actor.post(msg);
  }

  /** Start a created run: `created → starting`, then the prepare phases. */
  async startRun(runId: string): Promise<CommandResult> {
    if (!this.running) return this.unavailable();
    return this.result(await this.send(runId, { type: 'start' }));
  }

  /** An operator command (the P03 commands API calls this). */
  async command(runId: string, command: RunCommand): Promise<CommandResult> {
    if (!this.running) return this.unavailable();
    return this.result(await this.send(runId, { type: 'command', command }));
  }

  private unavailable(): CommandResult {
    return { ok: false, code: 'engine_unavailable', message: 'The workflow engine is not running in this process (another process owns this database, or it stopped)' };
  }

  private result(r: ProcessResult): CommandResult {
    if (r.ok) return r.rejected ? { ok: false, code: r.rejected.code as 'invalid_state', message: r.rejected.message } : { ok: true };
    if (r.reason === 'missing') return { ok: false, code: 'not_found', message: r.detail };
    return { ok: false, code: r.reason === 'fenced' ? 'fenced' : 'conflict', message: r.detail };
  }

  private actorFor(runId: string): Promise<RunActor | null> {
    let p = this.actors.get(runId);
    if (!p) {
      p = this.createActor(runId);
      this.actors.set(runId, p);
      void p.then((a) => {
        if (!a && this.actors.get(runId) === p) this.actors.delete(runId);
      });
    }
    return p;
  }

  private async createActor(runId: string): Promise<RunActor | null> {
    if (this.stopped) return null;
    const { stores } = this.deps;
    const row = stores.runs.getRunRow(runId);
    if (!row || TERMINAL.has(row.status)) return null;
    // The engine lock is held: any other owner of this database is dead.
    const epoch = stores.runs.claimOwnership(runId, this.bootId, this.timing.ownershipTtlMs, this.now(), { force: true });
    if (epoch === null) return null;
    const compiled = await this.compiled(runId);
    return new RunActor({
      runId,
      ownerEpoch: epoch,
      compiled,
      store: stores.runStore,
      dispatch: (id, res) => this.effects.dispatch(id, res),
      onFenced: (id) => this.drop(id),
      onTerminal: (id) => this.drop(id),
      now: this.now,
      ...(this.deps.random ? { random: this.deps.random } : {}),
      logger: this.deps.logger,
      onDecide: this.deps.onDecide,
    });
  }

  private async compiled(runId: string): Promise<CompiledWorkflow> {
    const run = await this.deps.runRepo.getById(runId);
    return compile(await this.deps.definitions.get(run.definitionVersionId));
  }

  private drop(runId: string): void {
    const p = this.actors.get(runId);
    this.actors.delete(runId);
    this.timers.forgetRun(runId);
    void p?.then((a) => a?.retire());
  }

  /** Runs this process hosts right now. */
  get hostedRuns(): string[] {
    return [...this.actors.keys()];
  }

  /** Resolves once the launches, lifecycle effects and outbox drains in flight have settled. */
  async idle(): Promise<void> {
    await this.effects.idle();
    await this.outbox.idle();
  }

  // ── Recovery (G5 §3.10) ──────────────────────────────────────

  async recover(): Promise<{ runs: number; interrupted: number; relaunched: number }> {
    const { stores } = this.deps;
    let interrupted = 0;
    let relaunched = 0;
    const runs = stores.queries.listLiveRunIds();
    for (const runId of runs) {
      const actor = await this.actorFor(runId);
      if (!actor) continue;
      const state = stores.runStore.loadRunState(runId);
      if (!state) continue;
      for (const inst of state.instances) {
        if (inst.attemptStatus !== 'running' || this.executor.hasFrame(inst.id)) continue;
        const attemptNo = inst.currentAttempt;
        if (inst.status === 'ready') {
          this.effects.launch(runId, inst.id, attemptNo);
          relaunched += 1;
        } else if (inst.status === 'starting' || inst.status === 'running' || inst.status === 'validating') {
          interrupted += 1;
          const safe = inFlightIsSafe(stores, inst.id);
          const epoch = journalEpoch(stores.attempts.listByStageRun(inst.id), attemptNo);
          const inFlight = stores.turns.inFlight(inst.id, `a${epoch}/`);
          await actor.post({
            type: 'attempt_settled',
            stageRunId: inst.id,
            attemptNo,
            outcome: {
              kind: 'failed',
              error: safe
                ? classified('lease_expired', 'The process restarted during the attempt; settled turns replay on resume', inFlight.length ? { inFlightOpId: inFlight[0]!.opId } : {})
                : classified('process_restart_unsafe', `The process restarted while turn ${inFlight[0]?.opId ?? '?'} was in flight; it may have changed the workspace`, {
                    inFlightOpId: inFlight[0]?.opId ?? '',
                  }),
              safeReplay: safe,
            },
          });
        } else if (inst.status === 'awaiting_input') {
          interrupted += 1;
          await actor.post({ type: 'frame_lost', stageRunId: inst.id, attemptNo });
        }
      }
      this.timers.loadRun(runId);
      const run = stores.runs.getRunRow(runId);
      if (run?.status === 'starting') this.effects.dispatch(runId, { effects: [{ t: 'prepare' }], timers: [], outbox: [] });
      else if ((run?.status === 'finalizing' || run?.status === 'cancelling') && run.outcome) {
        if (!state.instances.some((i) => i.attemptStatus === 'running' && i.status !== 'ready')) {
          this.effects.dispatch(runId, { effects: [{ t: 'finalize', outcome: run.outcome as RunOutcome, compensate: this.compensationOf(runId, run.outcome as RunOutcome) }], timers: [], outbox: [] });
        }
      }
      await actor.post({ type: 'tick' });
    }
    await this.outbox.drainAll();
    this.deps.logger?.info?.(`[RunSupervisor] recovered ${runs.length} run(s): ${interrupted} interrupted attempt(s), ${relaunched} relaunch(es)`);
    return { runs: runs.length, interrupted, relaunched };
  }

  /** The compensation list `decide()` gave the lost `finalize` (completed compensating instances, last first). */
  private compensationOf(runId: string, outcome: RunOutcome): string[] {
    if (outcome === 'completed') return [];
    const state = this.deps.stores.runStore.loadRunState(runId);
    if (!state) return [];
    return state.instances
      .filter((i) => i.status === 'completed')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || (a.instancePath < b.instancePath ? 1 : -1))
      .map((i) => i.id);
  }
}

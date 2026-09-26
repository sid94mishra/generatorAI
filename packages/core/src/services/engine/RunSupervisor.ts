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
//
// P05 containers recover the same way: a loop's or a map's effect in flight
// is dispatched again (all idempotent), a running mount_per_item map re-takes
// its worktree leases, a sub-workflow re-invokes its child (the same
// idempotency key finds the same run) or collects a child that finished
// while no process ran. A run whose actor sees it terminal posts
// `child_settled` to its parent when it is a sub-workflow child.
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
import { graphForInstance } from '../../domain/scheduler/expansion.js';
import { expansionNodes, expansionStateOf } from '../../domain/scheduler/scope.js';
import { compile, type CompiledWorkflow } from '../../domain/workflow-graph/compile.js';
import type { EventBus } from '../../events/EventBus.js';
import { CHECK_FLOW_KEY, GLOBAL_FLOW_KEY, modelFlowKey, providerFlowKey, type AdmissionController } from '../AdmissionController.js';
import type { RunDefinitionReader } from '../definitions/RunDefinitionReader.js';
import type { HookExecutor } from '../HookExecutor.js';
import type { PlanService } from '../PlanService.js';
import type { SessionComposer } from '../session/SessionComposer.js';
import type { StageProviderResolver } from '../WorkflowRunService.js';
import type { WorkspaceCheckpointService } from '../WorkspaceCheckpointService.js';
import type { WorkspaceManager } from '../WorkspaceManager.js';
import { EffectsDispatcher } from './EffectsDispatcher.js';
import { EngineTelemetry } from './EngineTelemetry.js';
import type { LifecycleSteps } from './lifecycle/steps.js';
import { LoopEffects } from './LoopEffects.js';
import { MapEffects } from './MapEffects.js';
import { SubworkflowEffects } from './SubworkflowEffects.js';
import { SummaryEffects } from './summaries.js';
import { WorktreeLeases } from './WorktreeLeases.js';
import type { WorkflowCallbacks } from './WorkflowCallbacks.js';
import { inFlightIsSafe, LeaseReaper } from './LeaseReaper.js';
import { OutboxDispatcher, type OutboxPublisher } from './OutboxDispatcher.js';
import { validateAgainstSchema } from './OutputExtractor.js';
import { RunActor, type DecideRecord, type ProcessResult } from './RunActor.js';
import { DefaultRunLifecycle, type LifecyclePlatform, type RunLifecycle, type RunLifecycleDeps } from './RunLifecycle.js';
import { journalEpoch, StageExecutor, stageSessionSpec, type ExecutorTiming, type StageArtifactReader } from './StageExecutor.js';
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
  /** Per-wait callback tokens (P05 §4.3). */
  callbacks?: WorkflowCallbacks | undefined;
  /** The workflow summary model of `llm` summaries (engine settings, read per summary); unset uses the stage's model. */
  summaryModel?: (() => string | null | undefined) | undefined;
  /** Where engine events go (default: `eventBus.emitGlobal`, awaited). */
  publish?: OutboxPublisher | undefined;
  /** Prepare/finalize (default: `DefaultRunLifecycle`). */
  lifecycle?: RunLifecycle | undefined;
  /** PD-17 start check of the default lifecycle's `prepare`. */
  permissionCheck?: RunLifecycleDeps['permissionCheck'];
  /** The default lifecycle's platform services known at construction (the rest are late-wired). */
  lifecyclePlatform?: LifecyclePlatform | undefined;
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
  | { ok: true; replayed?: boolean }
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
  readonly loops: LoopEffects;
  readonly leases: WorktreeLeases;
  readonly maps: MapEffects;
  readonly subworkflows: SubworkflowEffects;
  readonly summaries: SummaryEffects;
  /** Spans and metrics of the engine (P07 WP-7.4). */
  readonly telemetry = new EngineTelemetry();
  /** The compiled definition of every hosted run (the actors hold the same). */
  private readonly compiledByRun = new Map<string, CompiledWorkflow>();
  private readonly actors = new Map<string, Promise<RunActor | null>>();
  private readonly timing: SupervisorTiming;
  private readonly now: () => number;
  private lockTimer: ReturnType<typeof setInterval> | undefined;
  private providerResolver?: StageProviderResolver;
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
      callbacks: deps.callbacks,
      telemetry: this.telemetry,
      post,
      logger: deps.logger,
      now: this.now,
      ...(deps.timing?.executor ? { timing: deps.timing.executor } : {}),
    });
    this.timers = new TimerService({
      timers: deps.stores.timers,
      post: (runId, msg) => {
        // A launch waiting for a map to hand the run mounts back waits for no slot: its queue timeout does not count (MAPWAIT-R9).
        if (msg.type === 'timer_fired' && msg.kind === 'queue_timeout' && msg.stageRunId && this.effects.waitingOnLease(msg.stageRunId)) return;
        post(runId, msg);
      },
      now: this.now,
      logger: deps.logger,
    });
    this.outbox = new OutboxDispatcher({
      outbox: deps.stores.outbox,
      // The engine's own events drive its run and container spans (P07 WP-7.4).
      publish: async (e, row) => {
        this.telemetry.observe(e);
        await (deps.publish ? deps.publish(e, row) : deps.eventBus.emitGlobal(e as never));
      },
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
        subworkflowPins: (run, graph) => this.subworkflows.pinsAtRunStart(run, graph),
        ...(deps.lifecyclePlatform ?? {}),
        logger: deps.logger,
        now: this.now,
      });
    this.loops = new LoopEffects({ runRepo: deps.runRepo, workspaceManager: deps.workspaceManager, checkpoints: deps.checkpoints, logger: deps.logger });
    this.leases = new WorktreeLeases();
    const platform = () => {
      const p = this.lifecycle instanceof DefaultRunLifecycle ? this.lifecycle.platform : {};
      return { mounts: p.mounts, steps: p.steps as LifecycleSteps | undefined };
    };
    this.maps = new MapEffects({
      stores: deps.stores,
      runRepo: deps.runRepo,
      definitions: deps.definitions,
      workspaceManager: deps.workspaceManager,
      leases: this.leases,
      platform,
      scriptRunner: deps.scriptRunner,
      logger: deps.logger,
    });
    this.subworkflows = new SubworkflowEffects({
      stores: deps.stores,
      runRepo: deps.runRepo,
      definitions: deps.definitions,
      command: (runId, command) => this.command(runId, command).then((r) => (r.ok ? { ok: true } : { ok: false, message: r.message })),
      leases: this.leases,
      writerLeaseKeys: (runId, stageRunId) => this.writerLeaseKeys(runId, stageRunId),
      logger: deps.logger,
    });
    this.summaries = new SummaryEffects({
      stores: deps.stores,
      runRepo: deps.runRepo,
      definitions: deps.definitions,
      harness: deps.harness,
      post,
      summaryModel: deps.summaryModel,
      logger: deps.logger,
    });
    this.effects = new EffectsDispatcher({
      executor: this.executor,
      admission: deps.admission,
      timers: this.timers,
      outbox: this.outbox,
      lifecycle: this.lifecycle,
      post,
      flowKeysOf: (runId, stageRunId) => this.flowKeysOf(runId, stageRunId),
      notify: (kind, data) => void deps.eventBus.emitGlobal({ kind, data } as never).catch(() => undefined),
      loops: this.loops,
      maps: this.maps,
      leases: this.leases,
      writerLeaseKeys: (runId, stageRunId) => this.writerLeaseKeys(runId, stageRunId),
      subworkflows: this.subworkflows,
      summaries: this.summaries,
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
    this.loops.setCheckpoints(checkpoints);
    if (this.lifecycle instanceof DefaultRunLifecycle) this.lifecycle.setCheckpoints(checkpoints);
  }

  /**
   * Late wiring: which provider a stage runs on — the PD-17 resolver (the
   * bound agent's runtime, then routing by model), the same one the run
   * start check uses. Unset, the session's harness type or its model's
   * routed provider.
   */
  setProviderResolver(fn: StageProviderResolver): void {
    this.providerResolver = fn;
  }

  /** Late wiring: the lifecycle's mounts, uploads, project configs and sandbox (composition root, SDK). */
  setLifecyclePlatform(platform: LifecyclePlatform): void {
    if (this.lifecycle instanceof DefaultRunLifecycle) this.lifecycle.setPlatform(platform);
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
    this.telemetry.shutdown();
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
    // A message that arrives after the engine stopped (a late harness event) is dropped;
    // the next process's recovery re-derives what it meant.
    if (this.stopped) return;
    this.send(runId, msg).catch((err: unknown) => this.deps.logger?.warn(`[RunSupervisor] ${runId}: ${msg.type} was not delivered: ${String(err)}`));
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

  /**
   * An operator command (the P03 commands API calls this). `actor` is who
   * sent it (a wait's `output.by`). `deliver_event` stores the event first
   * (idempotent per key, outside the actor): a replay answers `replayed`, the
   * same key with other data is a conflict; the actor then lets a waiting
   * wait take it (P05 §4.3).
   */
  async command(runId: string, command: RunCommand, opts: { actor?: string } = {}): Promise<CommandResult> {
    if (!this.running) return this.unavailable();
    if (command.command === 'deliver_event') {
      const row = this.deps.stores.runs.getRunRow(runId);
      if (!row) return { ok: false, code: 'not_found', message: `run ${runId} does not exist` };
      if (TERMINAL.has(row.status) || row.status === 'created') return { ok: false, code: 'invalid_state', message: `the run is ${row.status}` };
      const d = this.deps.stores.events.deliver({ runId, eventKey: command.eventKey, idempotencyKey: command.idempotencyKey, data: command.data ?? null, now: this.now() });
      if (d.outcome === 'conflict') {
        return { ok: false, code: 'version_conflict', message: `event '${command.eventKey}' was already delivered with idempotency key '${command.idempotencyKey}' and other data` };
      }
      if (d.outcome === 'replayed') return { ok: true, replayed: true };
    }
    if (command.command === 'skip' && command.as === 'completed' && command.output !== undefined) {
      const refused = await this.skipOutputRefusal(runId, command.instanceId, command.output);
      if (refused) return { ok: false, code: 'invalid_command', message: refused };
    }
    return this.result(await this.send(runId, { type: 'command', command, ...(opts.actor ? { actor: opts.actor } : {}) }));
  }

  /** An output an operator records by skipping a json stage as completed must hold its output schema (ENGINE-R14). */
  private async skipOutputRefusal(runId: string, instanceRef: string | undefined, output: unknown): Promise<string | null> {
    const state = this.deps.stores.runStore.loadRunState(runId);
    const inst = state?.instances.find((i) => i.id === instanceRef || i.instancePath === instanceRef);
    if (!state || !inst) return null; // the actor answers not_found
    const run = await this.deps.runRepo.getById(runId);
    const graph = graphForInstance(await this.deps.definitions.get(run.definitionVersionId), state, inst);
    const stage = graph.stages.find((s) => s.key === inst.stageKey);
    if (stage?.kind !== 'agent' || stage.output.format !== 'json' || !stage.output.schema) return null;
    const r = validateAgainstSchema(stage.output.schema, output);
    return r.ok ? null : `The output does not match the stage's output schema: ${r.errors.slice(0, 5).join('; ')}`;
  }

  /**
   * The mount leases a launch must hold `write` on (P05 §4.1): none while
   * the run has no mount_per_item map; else the mounts it works in — the
   * run mounts, or inside a mount_per_item item that item's own worktrees
   * (where a nested map may hold them).
   */
  private async writerLeaseKeys(runId: string, stageRunId: string): Promise<string[]> {
    const compiled = this.compiledByRun.get(runId);
    if (!compiled || ![...compiled.nodes.values()].some((n) => n.map?.workspace === 'mount_per_item')) return [];
    return this.maps.leaseKeys(runId, stageRunId);
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
    this.compiledByRun.set(runId, compiled);
    return new RunActor({
      runId,
      ownerEpoch: epoch,
      compiled,
      store: stores.runStore,
      dispatch: (id, res) => this.effects.dispatch(id, res),
      onFenced: (id) => this.drop(id),
      onTerminal: (id) => {
        this.drop(id);
        void this.settleChild(id);
      },
      now: this.now,
      ...(this.deps.random ? { random: this.deps.random } : {}),
      logger: this.deps.logger,
      onDecide: this.deps.onDecide,
      telemetry: this.telemetry,
    });
  }

  private async compiled(runId: string): Promise<CompiledWorkflow> {
    const run = await this.deps.runRepo.getById(runId);
    return compile(await this.deps.definitions.get(run.definitionVersionId));
  }

  /** A sub-workflow child reached a terminal state: its parent's stage settles (P05 §4.2). */
  private async settleChild(runId: string): Promise<void> {
    try {
      const settled = await this.subworkflows.settledMessage(runId);
      if (settled) this.post(settled.parentRunId, settled.msg);
    } catch (err) {
      this.deps.logger?.warn(`[RunSupervisor] settling the parent of ${runId} failed: ${String(err)}`);
    }
  }

  private drop(runId: string): void {
    const p = this.actors.get(runId);
    this.actors.delete(runId);
    this.compiledByRun.delete(runId);
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
    // The running maps re-take their shared worktree leases FIRST, across
    // every run, so a relaunched writer queues behind them — and nothing here
    // awaits a lease: a writer holds its lease for a whole attempt (MAPWAIT-R8).
    for (const runId of runs) {
      for (const inst of stores.runStore.loadRunState(runId)?.instances ?? []) {
        const cs = inst.containerState;
        if (cs?.kind !== 'map' || inst.status !== 'running' || cs.phase === 'done' || cs.phase === 'snapshotting' || !cs.snapshot) continue;
        void this.leases.acquire(await this.maps.leaseKeys(runId), 'shared', inst.id);
      }
    }
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
        } else {
          // Its desired state was written (cancelled, paused, …) and the
          // frame died before it reported: the attempt is settled now, so a
          // cancelling run finalizes and a resumed stage launches (ENGINE-R3, R4).
          interrupted += 1;
          await actor.post({ type: 'attempt_settled', stageRunId: inst.id, attemptNo, outcome: { kind: 'aborted', reason: 'superseded' } });
        }
      }
      // A loop whose effect died with the process: dispatch it again (both are idempotent).
      for (const inst of state.instances) {
        const ls = inst.loopState;
        if (!ls || inst.status !== 'running') continue;
        if (ls.phase === 'starting') this.effects.dispatch(runId, { effects: [{ t: 'capture_iteration', stageRunId: inst.id, k: 0, at: 'start', checkpoint: false }], timers: [], outbox: [] });
        else if (ls.phase === 'settling') {
          const node = (await this.compiled(runId)).nodes.get(inst.stageKey);
          this.effects.dispatch(runId, {
            effects: [{ t: 'capture_iteration', stageRunId: inst.id, k: ls.k, at: 'end', checkpoint: node?.loop?.checkpointEachIteration ?? false }],
            timers: [],
            outbox: [],
          });
        } else if (ls.phase === 'restoring' && ls.pending?.kind === 'accept') {
          const row = state.iterations.find((r) => r.stageRunId === inst.id && r.k === (ls.pending as { k: number }).k);
          if (row?.checkpointTurnId) {
            this.effects.dispatch(runId, { effects: [{ t: 'restore_iteration', stageRunId: inst.id, k: row.k, checkpointTurnId: row.checkpointTurnId }], timers: [], outbox: [] });
          }
        }
      }
      // Maps and sub-workflows whose effect died with the process (P05 §4.1, §4.2).
      for (const inst of state.instances) {
        const cs = inst.containerState;
        const again = (d: Parameters<EffectsDispatcher['dispatch']>[1]['effects'][number]) => this.effects.dispatch(runId, { effects: [d], timers: [], outbox: [] });
        // A completed map's winner merge (P08 §7) in flight.
        if (cs?.kind === 'map' && cs.winner?.phase === 'merging' && cs.winner.index !== null) {
          again({ t: 'map_merge_item', stageRunId: inst.id, index: cs.winner.index, strategy: 'sequential' });
          continue;
        }
        if (!cs || inst.status !== 'running' || cs.phase === 'done') continue;
        if (cs.kind === 'map') {
          if (cs.phase === 'snapshotting') again({ t: 'map_snapshot', stageRunId: inst.id });
          const compiled = this.compiledByRun.get(runId);
          const merge = compiled?.nodes.get(inst.stageKey)?.map?.merge;
          for (const it of cs.items) {
            if (it.phase === 'preparing') again({ t: 'map_prepare_item', stageRunId: inst.id, index: it.index });
            else if (it.phase === 'merging') again({ t: 'map_merge_item', stageRunId: inst.id, index: it.index, strategy: merge === 'pr_per_item' ? 'pr_per_item' : 'sequential' });
          }
        } else if (cs.kind !== 'subworkflow') {
          // An expansion has no effect of its own: its planned stages recover as stages.
          continue;
        } else if (cs.phase === 'starting') {
          again({ t: 'start_child', stageRunId: inst.id, inputs: cs.inputs });
        } else if (cs.childRunId) {
          const settled = await this.subworkflows.settledMessage(cs.childRunId);
          if (settled) await actor.post(settled.msg);
          else if (this.compiledByRun.get(runId)?.nodes.get(inst.stageKey)?.subworkflow?.workspace === 'inherit') this.subworkflows.reacquire(runId, inst.id);
        }
      }
      // An `llm` summary that died with the process is written again (P07 WP-7.1).
      const compiledRun = await this.compiled(runId);
      for (const inst of state.instances) {
        if (inst.status === 'completed' && inst.summary === null && compiledRun.nodes.get(inst.stageKey)?.summary === 'llm') {
          this.effects.dispatch(runId, { effects: [{ t: 'summarize', stageRunId: inst.id }], timers: [], outbox: [] });
        }
      }
      this.timers.loadRun(runId);
      // A retry timer marked fired whose message died with the process (ENGINE-R13): its retry is due now.
      const retrying = new Set(stores.timers.listLive(runId).filter((t) => t.kind === 'retry').map((t) => t.stageRunId));
      for (const inst of state.instances) {
        if (inst.status === 'retry_wait' && !retrying.has(inst.id)) {
          await actor.post({ type: 'timer_fired', timerId: `recovered:${inst.id}`, kind: 'retry', stageRunId: inst.id });
        }
      }
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

  /**
   * The flow keys a launch is admitted on (P07 WP-7.2): `check:global` for
   * a check; else `global`, the stage's provider and — when the operator
   * configured it — its model. The provider is the PD-17 resolver's (a
   * bound agent's runtime counts), else the session's harness type, else
   * the one its model routes to. A provider that cannot be resolved leaves
   * `provider:` out: the stage's turns then take their own per-turn permit.
   */
  private async flowKeysOf(runId: string, stageRunId: string): Promise<string[]> {
    const inst = this.deps.stores.stages.getInstance(stageRunId);
    if (inst?.kind === 'check') return [CHECK_FLOW_KEY];
    const keys = [GLOBAL_FLOW_KEY];
    try {
      const run = await this.deps.runRepo.getById(runId);
      // A planned stage (P08 §8) reads its spec from its expansion's stored plan.
      const state = this.deps.stores.runStore.loadRunState(runId);
      const pinned = await this.deps.definitions.get(run.definitionVersionId);
      const si = state?.instances.find((i) => i.id === stageRunId);
      const graph = state && si ? graphForInstance(pinned, state, si) : pinned;
      const stage = graph.stages.find((s) => s.key === inst?.stageKey);
      if (stage?.kind !== 'agent') return keys;
      const spec = stageSessionSpec(graph, stage, run).merged;
      const projectId = run.projectId ?? graph.workflow.projectId ?? undefined;
      const provider = this.providerResolver
        ? await this.providerResolver({ session: spec, ...(projectId ? { projectId } : {}) })
        : (spec.harnessType ?? (await this.deps.harness.resolveProvider?.({ ...(spec.model ? { model: spec.model } : {}) })));
      if (provider) keys.push(providerFlowKey(provider));
      if (spec.model && this.deps.admission.currentFlowLimits()[modelFlowKey(spec.model)] !== undefined) keys.push(modelFlowKey(spec.model));
    } catch (err) {
      this.deps.logger?.warn(`[RunSupervisor] the flow keys of ${stageRunId} could not be resolved (global only): ${String(err)}`);
    }
    return keys;
  }

  /**
   * `run:<id>` of every hosted run (P07 WP-7.2): its stages in an attempt
   * against its `maxParallel` (`decide()` enforces it; reported here).
   */
  runFlows(): Array<{ flowKey: string; running: number; queued: number; limit: number }> {
    const out: Array<{ flowKey: string; running: number; queued: number; limit: number }> = [];
    for (const [runId, compiled] of this.compiledByRun) {
      const state = this.deps.stores.runStore.loadRunState(runId);
      if (!state || TERMINAL.has(state.run.status)) continue;
      // A planned stage's node is in its expansion's stored plan (P08 §8).
      const byId = new Map(state.instances.map((i) => [i.id, i]));
      const nodeOf = (i: (typeof state.instances)[number]) => {
        const base = compiled.nodes.get(i.stageKey);
        if (base || i.scopeId === null) return base;
        const container = byId.get(i.scopeId);
        const xs = container ? expansionStateOf(container) : null;
        return xs ? expansionNodes(xs).get(i.stageKey) : undefined;
      };
      const work = state.instances.filter((i) => nodeOf(i)?.class === 'work');
      const running = work.filter((i) => i.attemptStatus === 'running' && ['ready', 'starting', 'running', 'validating', 'awaiting_input'].includes(i.status)).length;
      const queued = work.filter((i) => i.status === 'pending').length;
      out.push({ flowKey: `run:${runId}`, running, queued, limit: compiled.maxParallel });
    }
    return out;
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

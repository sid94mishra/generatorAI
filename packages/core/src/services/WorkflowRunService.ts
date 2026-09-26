// ────────────────────────────────────────────────────────────────
// WorkflowRunService — the run facade over engine v2 (P03 WP-3.7/3.8, P04).
//
// The run records `WorkflowInvocationService` (THE way a run starts, P04)
// writes — a new run, or a fork — then start, command, delete and the run's
// permission mode. Everything that EXECUTES a run is the
// engine's (`RunSupervisor`: actor, `decide()`, executor, timers,
// recovery): a run's and an instance's status change only through its
// compare-and-set. Operator actions are run commands (G5 §3.7); re-running a
// terminal run is a fork (G5 §3.8), never a mutation of the source.
// ────────────────────────────────────────────────────────────────

import type { ILogger, RunSystemVars, StageRun, WorkflowRun, WorkflowRunPermissionMode } from '@generatorai/shared';
import {
  ConflictError,
  DEFAULT_AGENT_MODE,
  generateId,
  GeneratorAIError,
  getMeter,
  PermissionGatingUnsupportedError,
  ValidationError,
  withSpan,
} from '@generatorai/shared';
import {
  FORBIDDEN_VARIABLE_NAME_PATTERN,
  ForkRunRequestSchema,
  resolveSessionSpec,
  type ForkRunRequest,
  type RunCommand,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import type { IWorkflowRunRepository, MemoizedInstance, MemoizedIteration } from '../domain/ports/IWorkflowRunRepository.js';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import { instanceId } from '../domain/scheduler/ids.js';
import type { EventBus } from '../events/EventBus.js';
import { getDefaultChatPermissionMode, resolveTurnPermissionMode } from './agentModePolicy.js';
import type { RunDefinitionReader } from './definitions/RunDefinitionReader.js';
import type { CommandResult, RunSupervisor } from './engine/RunSupervisor.js';
import { validateRunVariables } from './workflow-invocation/validateInvocation.js';
import { checkPermissionGating, runPermissionMode } from './session/permissionSource.js';
import { ComposeError } from './session/types.js';
import type { WorkflowDefinitionService } from './WorkflowDefinitionService.js';
import type { WorkspaceCheckpointService } from './WorkspaceCheckpointService.js';

const meter = getMeter('core.workflow');
const runCounter = meter.createCounter('workflow.runs.total', { description: 'Total workflow runs created' });

/**
 * The system values a fork that REUSES the source workspace keeps: where the
 * source ran (workspace paths, codebases, uploads, sandbox-free). A fresh
 * fork keeps only the trigger's permission ceiling; its own lifecycle
 * provisions everything else.
 */
function forkSystemVars(source: RunSystemVars | undefined, reuse: boolean): RunSystemVars {
  const sv = source ?? {};
  if (!reuse) return sv.triggerPermissionMode ? { triggerPermissionMode: sv.triggerPermissionMode } : {};
  // Not the source's lifecycle journal, staged uploads, sandbox or step results: the fork's own lifecycle writes those.
  const dropped = new Set<keyof RunSystemVars>(['lifecycle', 'uploads', 'sandbox', 'preprocessing', 'postProcessing']);
  return Object.fromEntries(Object.entries(sv).filter(([k]) => !dropped.has(k as keyof RunSystemVars))) as RunSystemVars;
}

/** A new run's record, as the invocation resolved it (trusted: nothing here is validated again). */
export interface NewRunRecord {
  workflowDefinitionId: string;
  definitionVersionId: string;
  name?: string;
  variables: Record<string, unknown>;
  trigger: WorkflowRun['trigger'];
  invocationId?: string;
  idempotencyKey?: string;
  projectId?: string;
  permissionMode?: WorkflowRunPermissionMode;
  runOverrides?: WorkflowRun['runOverrides'];
  stageOverrides?: WorkflowRun['stageOverrides'];
  codebaseSelection?: WorkflowRun['codebaseSelection'];
  systemVars?: RunSystemVars;
  budget?: Record<string, unknown>;
  /** A sub-workflow child that inherits its parent's workspace (P05 §4.2). */
  workspaceId?: string;
  parentRunId?: string;
  parentStageRunId?: string;
  rootRunId?: string;
  depth?: number;
}

/**
 * Which provider a stage session would run on: its bound agent's runtime
 * folded in, then MultiHarness routing by model (PD-17 checks).
 */
export type StageProviderResolver = (params: { session: ReturnType<typeof resolveSessionSpec>; projectId?: string }) => Promise<string | undefined>;

const COMMAND_HTTP_STATUS: Record<Extract<CommandResult, { ok: false }>['code'], number> = {
  not_found: 404,
  invalid_command: 400,
  invalid_state: 409,
  version_conflict: 409,
  conflict: 409,
  fenced: 409,
  engine_unavailable: 503,
};

/** A refused start or command, with the HTTP status the commands API answers. */
export class RunCommandRefusedError extends GeneratorAIError {
  readonly category = 'state' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = false;
  readonly httpStatus: number;
  constructor(readonly result: Extract<CommandResult, { ok: false }>) {
    super(result.message, result.code.toUpperCase());
    this.httpStatus = COMMAND_HTTP_STATUS[result.code];
  }
}

const TERMINAL_RUN = new Set(['completed', 'failed', 'cancelled']);
type Mode = 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan';

export class WorkflowRunService {
  /** Resolves which provider a stage runs on, for the PD-17 checks (late-bound). */
  private providerResolver?: StageProviderResolver;
  /** Restores the source workspace of a `restore_checkpoint` fork (late-bound). */
  private checkpoints?: WorkspaceCheckpointService;

  constructor(
    private readonly runRepo: IWorkflowRunRepository,
    private readonly stageRunRepo: IStageRunRepository,
    /** The graph of each run's pinned definition version. */
    private readonly definitions: RunDefinitionReader,
    /** Resolves which version a new run pins. */
    private readonly definitionService: WorkflowDefinitionService,
    private readonly eventBus: EventBus,
    private readonly engine: RunSupervisor,
    private readonly logger?: ILogger,
  ) {}

  setProviderResolver(fn: StageProviderResolver): void {
    this.providerResolver = fn;
  }

  setCheckpointService(checkpoints: WorkspaceCheckpointService): void {
    this.checkpoints = checkpoints;
  }

  // ── Create ───────────────────────────────────────────────────

  /**
   * Write a `created` run pinned to an immutable definition version (W-13).
   * Only the invocation calls this: it validated the request, resolved the
   * version, the trigger, the lineage and the permission mode first. The
   * engine creates the instances when the run starts.
   */
  async createRun(record: NewRunRecord): Promise<WorkflowRun> {
    return withSpan('core.workflow', 'workflow.createRun', async (span) => {
      span.setAttribute('workflow.definition.id', record.workflowDefinitionId);
      const graph = await this.definitions.get(record.definitionVersionId);
      const now = new Date();
      const id = generateId();
      const run: WorkflowRun = {
        id,
        workflowDefinitionId: record.workflowDefinitionId,
        definitionVersionId: record.definitionVersionId,
        name: record.name?.trim() || `${graph.workflow.name} - Run ${now.getTime()}`,
        status: 'created',
        variables: record.variables,
        ...(record.trigger ? { trigger: record.trigger } : {}),
        ...(record.invocationId ? { invocationId: record.invocationId } : {}),
        ...(record.idempotencyKey ? { idempotencyKey: record.idempotencyKey } : {}),
        ...(record.projectId ? { projectId: record.projectId } : {}),
        ...(record.permissionMode ? { permissionMode: record.permissionMode } : {}),
        ...(record.runOverrides && Object.keys(record.runOverrides).length > 0 ? { runOverrides: record.runOverrides } : {}),
        ...(record.stageOverrides && record.stageOverrides.length > 0 ? { stageOverrides: record.stageOverrides } : {}),
        ...(record.codebaseSelection ? { codebaseSelection: record.codebaseSelection } : {}),
        ...(record.systemVars ? { systemVars: record.systemVars } : {}),
        ...(record.budget ? { budget: record.budget } : {}),
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
        ...(record.parentRunId ? { parentRunId: record.parentRunId } : {}),
        ...(record.parentStageRunId ? { parentStageRunId: record.parentStageRunId } : {}),
        rootRunId: record.rootRunId ?? id,
        depth: record.depth ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      run.effectivePermissionMode = this.effectiveMode(run, graph);
      await this.runRepo.create(run);
      await this.eventBus.emitGlobal({
        kind: 'workflow_run.created',
        data: { workflowRunId: run.id, name: run.name, workflowDefinitionId: run.workflowDefinitionId },
      });
      runCounter.add(1, { definition_id: record.workflowDefinitionId });
      span.setAttribute('workflow.run.id', run.id);
      return run;
    });
  }

  // ── Start and commands ───────────────────────────────────────

  /**
   * Start a created run. The PD-17 check refuses it before anything is
   * created for it; the engine then runs the prepare phases (`starting`)
   * and schedules it.
   */
  async startRun(runId: string): Promise<void> {
    const run = await this.runRepo.getById(runId);
    await this.assertPermissionGating(run, await this.definitions.get(run.definitionVersionId));
    const r = await this.engine.startRun(runId);
    if (!r.ok) throw new RunCommandRefusedError(r);
  }

  /** An operator command on the run or one of its instances (the commands API). */
  command(runId: string, command: RunCommand, opts: { actor?: string } = {}): Promise<CommandResult> {
    return this.engine.command(runId, command, opts);
  }

  // ── Fork (G5 §3.8) ───────────────────────────────────────────

  /**
   * Re-run a terminal run as a NEW run. Instances not downstream of any
   * `rerunFrom` path are memoized: copied as they ended, with their results,
   * and never re-validated (B-6). The fork carries the source's permission
   * mode, overrides, project, codebases and trigger lineage (W-59). The
   * invocation (`target: {kind: 'fork'}`) is its only caller.
   */
  async forkRun(
    sourceRunId: string,
    request: ForkRunRequest = {},
    meta: { trigger?: WorkflowRun['trigger']; invocationId?: string; name?: string } = {},
  ): Promise<WorkflowRun> {
    const opts = ForkRunRequestSchema.parse(request);
    return withSpan('core.workflow', 'workflow.forkRun', async (span) => {
      span.setAttribute('workflow.fork.source_run.id', sourceRunId);
      const idempotencyKey = opts.idempotencyKey ? `fork:${sourceRunId}:${opts.idempotencyKey}` : undefined;
      if (idempotencyKey) {
        const existing = await this.runRepo.findByIdempotencyKey(idempotencyKey);
        if (existing) return existing;
      }
      const source = await this.runRepo.getById(sourceRunId);
      if (!TERMINAL_RUN.has(source.status)) {
        throw new ConflictError(`Run ${sourceRunId} is ${source.status}: only a terminal run is forked (a live run takes run commands)`);
      }
      const sourceGraph = await this.definitions.get(source.definitionVersionId);
      const definitionVersionId =
        opts.definition === 'latest'
          ? await this.definitionService.resolveVersionForRun(source.workflowDefinitionId)
          : source.definitionVersionId;
      const graph = definitionVersionId === source.definitionVersionId ? sourceGraph : await this.definitions.get(definitionVersionId);

      const sourceInstances = await this.stageRunRepo.getByRunId(sourceRunId);
      const topLevel = sourceInstances.filter((i) => i.instancePath === i.stageKey);
      const rerunFrom = opts.rerunFrom ?? topLevel.filter((i) => i.status !== 'completed' && i.status !== 'skipped').map((i) => i.instancePath);
      // A path inside a container (`<loop>#k/…`, `<map>#i/…` or `<map>#<key>/…`,
      // P05 WP-5B.4) re-seeds that top-level container from inside; a plain
      // key re-runs the stage (and a container with all of its body).
      const plain = rerunFrom.filter((p) => !p.includes('#'));
      const nested = rerunFrom.filter((p) => p.includes('#') && !plain.includes(p.split('#')[0]!));
      const unknown = [...plain, ...nested.map((p) => p.split('#')[0]!)].filter((k) => !graph.stages.some((s) => s.key === k && !s.parentKey));
      if (unknown.length > 0) {
        throw new ValidationError(`rerunFrom: ${unknown.map((p) => `"${p}"`).join(', ')} is not a top-level stage of the forked version`);
      }
      const rerun = downstreamOf(graph, [...plain, ...nested.map((p) => p.split('#')[0]!)]);
      // `latest`: an instance whose stage changed is not memoized either.
      if (graph !== sourceGraph) {
        for (const stage of graph.stages) {
          const before = sourceGraph.stages.find((s) => s.key === stage.key);
          if (!before || stageHash(before) !== stageHash(stage)) for (const k of downstreamOf(graph, [stage.key])) rerun.add(k);
        }
      }

      // Variables are the source's user variables (system values live in
      // `system_vars`), with the override merged over them.
      const reuse = opts.workspace !== 'fresh';
      const userOverride = opts.variablesOverride ?? {};
      const reserved = Object.keys(userOverride).filter((k) => FORBIDDEN_VARIABLE_NAME_PATTERN.test(k));
      if (reserved.length > 0) throw new ValidationError(`variablesOverride: ${reserved.join(', ')} are engine-reserved names`);
      const variables = validateRunVariables(graph, { ...(source.variables ?? {}), ...userOverride }, { partial: true });

      const now = new Date();
      const id = generateId();
      const run: WorkflowRun = {
        id,
        workflowDefinitionId: source.workflowDefinitionId,
        definitionVersionId,
        name: meta.name?.trim() || `${graph.workflow.name} - Run ${now.getTime()}`,
        status: 'created',
        variables,
        ancestorRunId: sourceRunId,
        trigger: meta.trigger ?? { kind: 'fork', sourceRunId, principalId: 'system' },
        forkSpec: { rerunFrom, definition: opts.definition, workspace: opts.workspace, ...(opts.variablesOverride ? { variablesOverride: opts.variablesOverride } : {}) },
        ...(meta.invocationId ? { invocationId: meta.invocationId } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(source.projectId ? { projectId: source.projectId } : {}),
        ...(source.permissionMode ? { permissionMode: source.permissionMode } : {}),
        ...(source.runOverrides ? { runOverrides: source.runOverrides } : {}),
        ...(source.stageOverrides ? { stageOverrides: source.stageOverrides } : {}),
        ...(source.codebaseSelection !== undefined ? { codebaseSelection: source.codebaseSelection } : {}),
        ...(source.budget ? { budget: source.budget } : {}),
        systemVars: forkSystemVars(source.systemVars, reuse),
        ...(reuse && source.workspaceId ? { workspaceId: source.workspaceId } : {}),
        // A fork is a sibling of its source in the run tree: same parent, same root.
        ...(source.parentRunId ? { parentRunId: source.parentRunId } : {}),
        ...(source.parentStageRunId ? { parentStageRunId: source.parentStageRunId } : {}),
        rootRunId: source.parentRunId ? (source.rootRunId ?? id) : id,
        depth: source.depth ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      run.effectivePermissionMode = this.effectiveMode(run, graph);

      const memoized: MemoizedInstance[] = [];
      for (const inst of topLevel) {
        if (rerun.has(inst.stageKey) || !graph.stages.some((s) => s.key === inst.stageKey)) continue;
        if (inst.status !== 'completed' && inst.status !== 'skipped' && inst.status !== 'failed') continue;
        memoized.push(memoize(run.id, inst));
      }
      // Containers re-seeded from inside keep what ran before the path (P05 WP-5B.4).
      const seeding: Seeding = { runId: run.id, graph, source: sourceInstances, memoized, iterations: [], rerunSourceIds: new Set(), now: now.getTime() };
      for (const path of nested) {
        const [head, ...rest] = path.split('/');
        const [key, idx] = head!.split('#');
        const src = topLevel.find((i) => i.stageKey === key);
        if (!src) throw new ValidationError(`rerunFrom: "${path}" names the container "${key}", which did not run in run ${sourceRunId}`);
        if (memoized.some((m) => m.instancePath === src.instancePath)) continue;
        await this.seedContainer(seeding, src, { scopeId: null }, idx ?? '', rest, path);
      }
      for (const inst of sourceInstances) {
        const top = inst.instancePath.split(/[#/]/)[0]!;
        if (plain.includes(top) || (rerun.has(top) && !nested.some((p) => p.split('#')[0] === top))) seeding.rerunSourceIds.add(inst.id);
      }

      if (opts.workspace === 'restore_checkpoint') await this.restoreForFork(source, sourceInstances, seeding.rerunSourceIds);

      await this.runRepo.createFork(run, memoized, seeding.iterations);
      await this.eventBus.emitGlobal({
        kind: 'workflow_run.created',
        data: { workflowRunId: run.id, name: run.name, workflowDefinitionId: run.workflowDefinitionId },
      });
      await this.eventBus.emitGlobal({
        kind: 'workflow_run.forked',
        data: { workflowRunId: run.id, ancestorRunId: sourceRunId, rerunFrom, memoized: memoized.length },
      });
      runCounter.add(1, { definition_id: source.workflowDefinitionId });
      if (opts.start) await this.startRun(run.id);
      return this.runRepo.getById(run.id);
    });
  }

  /**
   * Re-seed a container from inside (P05 WP-5B.4). A loop re-run from
   * `<loop>#k/<key>…` keeps iterations 0..k-1 (their instances and their
   * `loop_iterations` rows, so carry(k-1) seeds iteration k) and restarts in
   * iteration k: the body stages not downstream of `<key>` are copied, the
   * rest run again. A map re-run from `<map>#<index or key>/<key>…` keeps
   * every other item as it ended and runs that item again (its body stages
   * upstream of `<key>` copied). A deeper path re-seeds the nested
   * container the same way.
   */
  private async seedContainer(
    s: Seeding,
    src: StageRun,
    placement: { scopeId: string | null; iterationIndex?: number; itemIndex?: number; itemKey?: string },
    idx: string,
    rest: readonly string[],
    path: string,
  ): Promise<void> {
    const stage = s.graph.stages.find((x) => x.key === src.stageKey);
    if (!stage || (stage.kind !== 'loop' && stage.kind !== 'map')) throw new ValidationError(`rerunFrom: "${path}": "${src.stageKey}" is not a loop or a map`);
    const bodyKeys = s.graph.stages.filter((x) => x.parentKey === stage.key).map((x) => x.key);
    const next = rest[0]?.split('#')[0];
    if (!next || !bodyKeys.includes(next)) throw new ValidationError(`rerunFrom: "${path}": "${next ?? ''}" is not in the body of "${stage.key}"`);
    const newId = instanceId(s.runId, src.instancePath);
    const bodyGraph = { ...s.graph, edges: s.graph.edges.filter((e) => bodyKeys.includes(e.from) && bodyKeys.includes(e.to)) };
    const rerunBody = downstreamOf(bodyGraph, [next]);
    const scopeOf = (i: StageRun) => (i.instancePath.startsWith(`${src.instancePath}#`) ? Number(i.instancePath.slice(src.instancePath.length + 1).split('/')[0]) : NaN);
    const below = s.source.filter((i) => i.instancePath.startsWith(`${src.instancePath}#`));
    const copyTree = (root: StageRun) => {
      for (const i of s.source) if (i.id === root.id || i.instancePath.startsWith(`${root.instancePath}#`)) s.memoized.push(memoizeNested(s.runId, s.source, i));
    };

    let index: number;
    let containerState: unknown;
    let bodyPlacement: { iterationIndex?: number; itemIndex?: number; itemKey?: string };
    if (stage.kind === 'loop') {
      index = Number(idx);
      const rows = await this.stageRunRepo.getLoopIterations(src.id);
      if (!Number.isInteger(index) || index < 0 || index > rows.length) throw new ValidationError(`rerunFrom: "${path}": iteration ${idx} of "${stage.key}" did not run`);
      for (const r of rows.filter((x) => x.k < index)) {
        s.iterations.push({ ...r, stageRunId: newId, carry: r.carry, exitValues: r.exitValues, streaks: r.streaks, signals: r.signals, usage: r.usage });
      }
      const ls = src.loopState;
      const prior = rows.find((x) => x.k === index - 1);
      containerState = {
        ...(ls ?? {}),
        k: index,
        phase: 'running',
        effectiveMax: Math.max(ls?.effectiveMax ?? stage.loop.maxIterations, index + 1),
        streaks: prior?.streaks ?? stage.loop.exits.map(() => 0),
        exitReason: null,
        exitAction: null,
        operatorInput: null,
        startedAt: s.now,
        parkedMs: 0,
        parkedSince: null,
        wrappedUp: false,
        pending: null,
      };
      for (const i of below) if (scopeOf(i) < index) s.memoized.push(memoizeNested(s.runId, s.source, i));
      bodyPlacement = { iterationIndex: index };
    } else {
      const ms = src.mapState;
      if (!ms) throw new ValidationError(`rerunFrom: "${path}": the map "${stage.key}" did not start`);
      const byIndex = /^\d+$/.test(idx) ? ms.items.find((it) => it.index === Number(idx)) : undefined;
      const item = byIndex ?? ms.items.find((it) => it.key === idx);
      if (!item) throw new ValidationError(`rerunFrom: "${path}": the map "${stage.key}" has no item "${idx}"`);
      index = item.index;
      containerState = {
        ...ms,
        phase: 'running',
        items: ms.items.map((it) =>
          it.index === index
            ? { ...it, phase: 'pending', status: null, errorCode: null, error: null, workspaceId: null, mounts: null, primaryDir: null, branch: null, pr: null }
            : it,
        ),
      };
      for (const i of below) if (scopeOf(i) !== index) s.memoized.push(memoizeNested(s.runId, s.source, i));
      bodyPlacement = { itemIndex: index, itemKey: item.key };
    }
    s.memoized.push({
      ...memoize(s.runId, src),
      status: 'running',
      statusReason: 'fork',
      outputData: null,
      outputText: null,
      summary: null,
      error: null,
      errorClass: null,
      errorCode: null,
      completedAt: null,
      ...placementFields(placement),
      containerState,
    });

    // The re-run scope: copied upstream of the path, re-seeded along it, fresh after it.
    for (const key of bodyKeys) {
      const bodyPath = `${src.instancePath}#${index}/${key}`;
      const prev = s.source.find((i) => i.instancePath === bodyPath);
      const inScope = { scopeId: newId, ...bodyPlacement };
      if (prev && !rerunBody.has(key) && (prev.status === 'completed' || prev.status === 'skipped')) {
        copyTree(prev);
        continue;
      }
      if (prev) for (const i of s.source) if (i.id === prev.id || i.instancePath.startsWith(`${prev.instancePath}#`)) s.rerunSourceIds.add(i.id);
      if (key === next && rest[0]!.includes('#') && prev) {
        await this.seedContainer(s, prev, inScope, rest[0]!.split('#')[1] ?? '', rest.slice(1), path);
        continue;
      }
      // A loop scope is complete up front; a map item's rows are created when it starts.
      if (stage.kind === 'loop') {
        const body = s.graph.stages.find((x) => x.key === key)!;
        s.memoized.push({
          id: instanceId(s.runId, bodyPath),
          copiedFromStageRunId: prev?.id ?? '',
          stageKey: key,
          kind: body.kind,
          name: body.name,
          instancePath: bodyPath,
          status: 'pending',
          statusReason: null,
          skipReason: null,
          gateAs: null,
          outputData: null,
          outputText: null,
          summary: null,
          artifactManifest: null,
          error: null,
          errorClass: null,
          errorCode: null,
          usage: {},
          startedAt: null,
          completedAt: null,
          ...placementFields(inScope),
        });
      }
    }
  }

  /** Roll the source workspace back to the checkpoint taken before the earliest re-run instance's first attempt. */
  private async restoreForFork(source: WorkflowRun, instances: readonly StageRun[], rerunIds: ReadonlySet<string>): Promise<void> {
    const workspaceId = source.workspaceId;
    const earliest = instances
      .filter((i) => rerunIds.has(i.id) && i.startedAt)
      .sort((a, b) => a.startedAt!.getTime() - b.startedAt!.getTime())[0];
    if (!workspaceId || !earliest) return;
    if (!this.checkpoints) throw new ValidationError('restore_checkpoint: checkpoints are not available in this process');
    const r = await this.checkpoints.restoreTurn(workspaceId, `attempt:${earliest.id}:1`, { workflowRunId: source.id }, 'before');
    if (r.mounts.length === 0) {
      this.logger?.warn(`[WorkflowRunService] fork of ${source.id}: no checkpoint before "${earliest.name}"; the workspace is reused as it is`);
    } else if (!r.mounts.every((m) => m.ok)) {
      throw new ConflictError(`restore_checkpoint: the workspace of run ${source.id} could not be restored to before "${earliest.name}"`);
    }
  }

  // ── Delete ───────────────────────────────────────────────────

  /** Delete a run that is not live (a live run is cancelled first, with the `cancel` command). */
  async deleteRun(runId: string): Promise<void> {
    const run = await this.runRepo.getById(runId);
    if (run.status !== 'created' && !TERMINAL_RUN.has(run.status)) {
      throw new ConflictError(`Run ${runId} is ${run.status}: cancel it before deleting it`);
    }
    await this.stageRunRepo.deleteByRunId(runId);
    await this.runRepo.delete(runId);
  }

  // ── Permission mode ──────────────────────────────────────────

  /**
   * Change the run's own permission mode (the run row, the most specific
   * layer). Stages read it from their next turn on. Emits
   * `workflow_run.permission_mode_changed` with the previously EFFECTIVE mode.
   */
  async setPermissionMode(runId: string, mode: Mode): Promise<void> {
    const previous = await this.getPermissionMode(runId);
    const run = await this.runRepo.getById(runId);
    if (run.permissionMode === mode) return;
    // PD-17 — a live run cannot be switched to a mode a stage's provider
    // cannot hold, any more than it could be started in one (review R8).
    const graph = await this.definitions.get(run.definitionVersionId);
    const next = { ...run, permissionMode: mode };
    await this.assertPermissionGating(next, graph);
    await this.runRepo.update(runId, { permissionMode: mode, effectivePermissionMode: this.effectiveMode(next, graph) });
    await this.eventBus.emitGlobal({ kind: 'workflow_run.permission_mode_changed', data: { workflowRunId: runId, mode, previous } });
  }

  /**
   * The run's effective permission mode: the run row, else the workflow
   * session, else the trigger's, else the deployment posture. Never a bypass
   * default (W-07). A stage's own session mode can still tighten it.
   */
  async getPermissionMode(runId: string): Promise<Mode> {
    const run = await this.runRepo.getById(runId);
    const graph = await this.definitions.get(run.definitionVersionId).catch(() => null);
    return (runPermissionMode(run, undefined, graph?.workflow.session) ?? getDefaultChatPermissionMode()) as Mode;
  }

  private effectiveMode(run: WorkflowRun, graph: WorkflowGraph): WorkflowRunPermissionMode {
    return (runPermissionMode(run, undefined, graph.workflow.session) ?? getDefaultChatPermissionMode()) as WorkflowRunPermissionMode;
  }

  /**
   * PD-17 — refuse a run whose permission mode a stage's provider cannot
   * hold (opencode never asks, so `default`/`plan` would silently run
   * unattended). Checked per stage with the stage's own session layered over
   * the workflow's. The engine's `prepare` runs it too, for every entry point.
   */
  async assertPermissionGating(run: WorkflowRun, graph: WorkflowGraph): Promise<void> {
    const projectId = run.projectId ?? graph.workflow.projectId ?? undefined;
    for (const stage of graph.stages) {
      if (stage.kind !== 'agent') continue; // only agent stages hold a session
      const session = resolveSessionSpec(graph.workflow.session, stage.session);
      // The bound agent's runtime harness counts too (review R8).
      const provider = this.providerResolver ? await this.providerResolver({ session, ...(projectId ? { projectId } : {}) }) : session.harnessType;
      const mode = runPermissionMode(run, stage.session, graph.workflow.session);
      try {
        checkPermissionGating(provider, mode);
        // The mode its turns run under: a `plan` default agent mode runs `plan` turns (review R6).
        checkPermissionGating(provider, resolveTurnPermissionMode(session.defaultAgentMode ?? DEFAULT_AGENT_MODE, mode));
      } catch (err) {
        if (err instanceof ComposeError) throw new PermissionGatingUnsupportedError(`Stage "${stage.name}": ${err.message}`);
        throw err;
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────

/** The stage keys `from` reaches over any edge, `from` included. */
function downstreamOf(graph: WorkflowGraph, from: readonly string[]): Set<string> {
  const out = new Set<string>(from);
  const queue = [...from];
  while (queue.length > 0) {
    const key = queue.shift()!;
    for (const e of graph.edges) {
      if (e.from === key && !out.has(e.to)) {
        out.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return out;
}

/** A stage's spec with sorted keys, for the `latest` fork's memoization check. */
function stageHash(stage: WorkflowGraph['stages'][number]): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(stable(stage));
}

/** What a fork builds while re-seeding containers from inside (P05 WP-5B.4). */
interface Seeding {
  runId: string;
  graph: WorkflowGraph;
  source: readonly StageRun[];
  memoized: MemoizedInstance[];
  iterations: MemoizedIteration[];
  /** Source instances that run again (the `restore_checkpoint` workspace rolls back to before the earliest). */
  rerunSourceIds: Set<string>;
  now: number;
}

function placementFields(p: { scopeId?: string | null; iterationIndex?: number; itemIndex?: number; itemKey?: string }): Partial<MemoizedInstance> {
  return {
    ...(p.scopeId ? { scopeId: p.scopeId } : {}),
    ...(p.iterationIndex !== undefined ? { iterationIndex: p.iterationIndex } : {}),
    ...(p.itemIndex !== undefined ? { itemIndex: p.itemIndex } : {}),
    ...(p.itemKey !== undefined ? { itemKey: p.itemKey } : {}),
  };
}

/** A copied instance inside a container: its scope is the fork's copy of its source container (paths are kept). */
function memoizeNested(runId: string, source: readonly StageRun[], inst: StageRun): MemoizedInstance {
  const parent = inst.scopeId ? source.find((i) => i.id === inst.scopeId) : undefined;
  return {
    ...memoize(runId, inst),
    ...placementFields({
      scopeId: parent ? instanceId(runId, parent.instancePath) : null,
      ...(inst.iterationIndex !== undefined ? { iterationIndex: inst.iterationIndex } : {}),
      ...(inst.itemIndex !== undefined ? { itemIndex: inst.itemIndex } : {}),
      ...(inst.itemKey !== undefined ? { itemKey: inst.itemKey } : {}),
    }),
    ...(inst.loopState ? { containerState: inst.loopState } : inst.mapState ? { containerState: inst.mapState } : inst.subworkflowState ? { containerState: inst.subworkflowState } : {}),
  };
}

function memoize(runId: string, inst: StageRun): MemoizedInstance {
  return {
    id: instanceId(runId, inst.instancePath),
    copiedFromStageRunId: inst.id,
    stageKey: inst.stageKey,
    kind: inst.kind,
    name: inst.name,
    instancePath: inst.instancePath,
    status: inst.status as MemoizedInstance['status'],
    statusReason: 'memoized',
    skipReason: inst.skipReason ?? null,
    gateAs: null,
    outputData: inst.outputData ?? null,
    outputText: inst.outputText ?? null,
    summary: inst.summary ?? null,
    artifactManifest: inst.artifactManifest ?? null,
    error: inst.error ?? null,
    errorClass: inst.errorClass ?? null,
    errorCode: inst.errorCode ?? null,
    usage: {},
    startedAt: inst.startedAt ?? null,
    completedAt: inst.completedAt ?? null,
  };
}

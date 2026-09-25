// ────────────────────────────────────────────────────────────────
// WorkflowRunService — the run facade over engine v2 (P03 WP-3.7/3.8).
//
// create (until P04's invocation), start, command, fork, get, list, delete
// and the run's permission mode. Everything that EXECUTES a run is the
// engine's (`RunSupervisor`: actor, `decide()`, executor, timers,
// recovery): a run's and an instance's status change only through its
// compare-and-set. Operator actions are run commands (G5 §3.7); re-running a
// terminal run is a fork (G5 §3.8), never a mutation of the source.
// ────────────────────────────────────────────────────────────────

import type {
  CreateWorkflowRunParams,
  ILogger,
  StageRun,
  WorkflowRun,
  WorkflowRunPermissionMode,
} from '@generatorai/shared';
import {
  ConflictError,
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
import type { IWorkflowRunRepository, MemoizedInstance } from '../domain/ports/IWorkflowRunRepository.js';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import { instanceId } from '../domain/scheduler/ids.js';
import type { EventBus } from '../events/EventBus.js';
import { getDefaultChatPermissionMode } from './agentModePolicy.js';
import type { RunDefinitionReader } from './definitions/RunDefinitionReader.js';
import type { CommandResult, RunSupervisor } from './engine/RunSupervisor.js';
import { checkPermissionGating, runPermissionMode, TRIGGER_PERMISSION_MODE_KEY } from './session/permissionSource.js';
import { ComposeError } from './session/types.js';
import type { WorkflowDefinitionService } from './WorkflowDefinitionService.js';
import type { WorkspaceCheckpointService } from './WorkspaceCheckpointService.js';

const meter = getMeter('core.workflow');
const runCounter = meter.createCounter('workflow.runs.total', { description: 'Total workflow runs created' });

/**
 * Variables that describe WHERE a run executed rather than WHAT it was asked
 * to do. A fork into a fresh workspace drops them: `prepare` provisions a
 * workspace only when the directory keys are absent, and the worktree paths
 * point into the source run's checkout.
 */
const EXECUTION_CONTEXT_KEYS = new Set(['__workingDirectory', '__artifactsDirectory', '__workspaceId', '__workflowRunId']);
const WORKTREE_VARIABLE_PATTERN = /^repo_(path|branch)_/;

export function stripExecutionContext(variables: Record<string, unknown>): { variables: Record<string, unknown>; dropped: string[] } {
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(variables)) {
    if (EXECUTION_CONTEXT_KEYS.has(key) || WORKTREE_VARIABLE_PATTERN.test(key)) dropped.push(key);
    else kept[key] = value;
  }
  return { variables: kept, dropped };
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
   * Create a `created` run pinned to an immutable definition version (W-13):
   * the definition's current published version, or a test version of its
   * working graph (`testRun`). The engine creates the instances when the
   * run starts (deterministic ids, one per top-level stage).
   */
  async createRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
    // R-8: engine state (`__*`, codebase checkouts) never comes from caller
    // variables; it is derived from the typed params below.
    const reserved = Object.keys(params.variables ?? {}).filter((k) => FORBIDDEN_VARIABLE_NAME_PATTERN.test(k));
    if (reserved.length > 0) {
      throw new ValidationError(
        `Invalid workflow run variables: ${reserved.map((k) => `"${k}"`).join(', ')} ` +
          'are engine-reserved names (__*, repo_path_*, repo_branch_*) and cannot be supplied',
      );
    }
    return withSpan('core.workflow', 'workflow.createRun', async (span) => {
      span.setAttribute('workflow.definition_id', params.workflowDefinitionId);
      const definitionVersionId =
        params.definitionVersionId ??
        (await this.definitionService.resolveVersionForRun(params.workflowDefinitionId, { testRun: params.testRun === true }));
      const graph = await this.definitions.get(definitionVersionId);
      const variables: Record<string, unknown> = { ...withDefaults(graph, validateVariables(graph, params.variables ?? {})) };
      if (params.projectId) variables['__projectId'] = params.projectId;
      // PD-18 — the trigger's declared mode sits under the stage and workflow
      // session modes (see `runPermissionMode`); it is not the run row.
      if (params.triggerPermissionMode) variables[TRIGGER_PERMISSION_MODE_KEY] = params.triggerPermissionMode;
      const now = new Date();
      const run: WorkflowRun = {
        id: generateId(),
        workflowDefinitionId: params.workflowDefinitionId,
        definitionVersionId,
        name: `${graph.workflow.name} - Run ${now.getTime()}`,
        status: 'created',
        variables,
        trigger: params.triggeredBy ? { kind: 'automation', via: params.triggeredBy } : { kind: 'user' },
        ...(params.projectId ? { projectId: params.projectId } : {}),
        ...(params.permissionMode ? { permissionMode: params.permissionMode } : {}),
        ...(params.stageOverrides && params.stageOverrides.length > 0 ? { stageOverrides: params.stageOverrides } : {}),
        createdAt: now,
        updatedAt: now,
      };
      run.effectivePermissionMode = this.effectiveMode(run, graph);
      await this.runRepo.create(run);
      await this.eventBus.emitGlobal({
        kind: 'workflow_run.created',
        data: { workflowRunId: run.id, name: run.name, workflowDefinitionId: run.workflowDefinitionId },
      });
      runCounter.add(1, { definition_id: params.workflowDefinitionId });
      span.setAttribute('workflow.run_id', run.id);
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
  command(runId: string, command: RunCommand): Promise<CommandResult> {
    return this.engine.command(runId, command);
  }

  /**
   * A setup phase that runs before `start` (the orchestrator's clone and
   * preprocessing until P04 moves them into `prepare`) failed: the run goes
   * `created → starting → failed` with `status_reason setup:<phase>`, the
   * same outcome a failed prepare phase has.
   */
  async failSetup(runId: string, phase: string, error: string): Promise<void> {
    const started = this.engine.stores.runs.transition(runId, ['created'], 'starting');
    if (!started.ok) return;
    const failed = this.engine.stores.runs.transition(runId, ['starting'], 'failed', {
      patch: { statusReason: `setup:${phase}`, outcome: 'failed', error },
    });
    if (failed.ok) await this.eventBus.emitGlobal({ kind: 'workflow_run.failed', data: { workflowRunId: runId, error } });
  }

  // ── Fork (G5 §3.8) ───────────────────────────────────────────

  /**
   * Re-run a terminal run as a NEW run. Instances not downstream of any
   * `rerunFrom` path are memoized: copied as they ended, with their results,
   * and never re-validated (B-6). The fork carries the source's permission
   * mode, overrides, project and trigger lineage (W-59).
   */
  async forkRun(sourceRunId: string, request: ForkRunRequest = {}): Promise<WorkflowRun> {
    const opts = ForkRunRequestSchema.parse(request);
    return withSpan('core.workflow', 'workflow.forkRun', async (span) => {
      span.setAttribute('workflow.run_id', sourceRunId);
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
      const unknown = rerunFrom.filter((p) => !graph.stages.some((s) => s.key === p));
      if (unknown.length > 0) {
        throw new ValidationError(`rerunFrom: ${unknown.map((p) => `"${p}"`).join(', ')} is not a top-level stage of the forked version`);
      }
      const rerun = downstreamOf(graph, rerunFrom);
      // `latest`: an instance whose stage changed is not memoized either.
      if (graph !== sourceGraph) {
        for (const stage of graph.stages) {
          const before = sourceGraph.stages.find((s) => s.key === stage.key);
          if (!before || stageHash(before) !== stageHash(stage)) for (const k of downstreamOf(graph, [stage.key])) rerun.add(k);
        }
      }

      // Variables: the source's, minus its execution context unless the fork reuses the workspace.
      const reuse = opts.workspace !== 'fresh';
      const base = reuse ? { ...source.variables } : stripExecutionContext(source.variables ?? {}).variables;
      const userOverride = opts.variablesOverride ?? {};
      const reserved = Object.keys(userOverride).filter((k) => FORBIDDEN_VARIABLE_NAME_PATTERN.test(k));
      if (reserved.length > 0) throw new ValidationError(`variablesOverride: ${reserved.join(', ')} are engine-reserved names`);
      const variables = { ...base, ...validateVariables(graph, { ...userVariablesOf(base), ...userOverride }, true) };

      const now = new Date();
      const run: WorkflowRun = {
        id: generateId(),
        workflowDefinitionId: source.workflowDefinitionId,
        definitionVersionId,
        name: `${graph.workflow.name} - Run ${now.getTime()}`,
        status: 'created',
        variables,
        ancestorRunId: sourceRunId,
        trigger: { kind: 'fork', sourceRunId, sourceTrigger: source.trigger ?? null },
        forkSpec: { rerunFrom, definition: opts.definition, workspace: opts.workspace, ...(opts.variablesOverride ? { variablesOverride: opts.variablesOverride } : {}) },
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(source.projectId ? { projectId: source.projectId } : {}),
        ...(source.permissionMode ? { permissionMode: source.permissionMode } : {}),
        ...(source.stageOverrides ? { stageOverrides: source.stageOverrides } : {}),
        ...(source.codebaseSelection !== undefined ? { codebaseSelection: source.codebaseSelection } : {}),
        ...(reuse && source.workspaceId ? { workspaceId: source.workspaceId } : {}),
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

      if (opts.workspace === 'restore_checkpoint') await this.restoreForFork(source, sourceInstances, rerun);

      await this.runRepo.createFork(run, memoized);
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

  /** Roll the source workspace back to the checkpoint taken before the earliest re-run instance's first attempt. */
  private async restoreForFork(source: WorkflowRun, instances: readonly StageRun[], rerun: ReadonlySet<string>): Promise<void> {
    const workspaceId = source.workspaceId ?? (source.variables?.['__workspaceId'] as string | undefined);
    const earliest = instances
      .filter((i) => rerun.has(i.stageKey) && i.startedAt)
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
    const projectId = (run.variables?.['__projectId'] as string | undefined) ?? graph.workflow.projectId ?? undefined;
    for (const stage of graph.stages) {
      const session = resolveSessionSpec(graph.workflow.session, stage.session);
      // The bound agent's runtime harness counts too (review R8).
      const provider = this.providerResolver ? await this.providerResolver({ session, ...(projectId ? { projectId } : {}) }) : session.harnessType;
      try {
        checkPermissionGating(provider, runPermissionMode(run, stage.session, graph.workflow.session));
      } catch (err) {
        if (err instanceof ComposeError) throw new PermissionGatingUnsupportedError(`Stage "${stage.name}": ${err.message}`);
        throw err;
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────

/** The caller's variables checked against the declared ones: types, `required`, choice options. */
function validateVariables(graph: WorkflowGraph, provided: Record<string, unknown>, partial = false): Record<string, unknown> {
  const issues: string[] = [];
  for (const v of graph.workflow.variables) {
    const raw = provided[v.name];
    if (raw === undefined || raw === null || raw === '') {
      if (!partial && v.required && v.defaultValue === undefined) issues.push(`variable "${v.name}" is required`);
      continue;
    }
    switch (v.type) {
      case 'string':
      case 'text':
        if (typeof raw !== 'string') issues.push(`variable "${v.name}" must be a string (got ${typeof raw})`);
        break;
      case 'number':
        if (typeof raw !== 'number' || Number.isNaN(raw)) issues.push(`variable "${v.name}" must be a number (got ${typeof raw})`);
        break;
      case 'boolean':
        if (typeof raw !== 'boolean') issues.push(`variable "${v.name}" must be a boolean (got ${typeof raw})`);
        break;
      case 'choice':
        if (typeof raw !== 'string') issues.push(`variable "${v.name}" must be a string (got ${typeof raw})`);
        else if (v.options && v.options.length > 0 && !v.options.includes(raw)) {
          issues.push(`variable "${v.name}" must be one of [${v.options.join(', ')}] (got "${raw}")`);
        }
        break;
    }
  }
  if (issues.length > 0) throw new ValidationError(`Invalid workflow run variables: ${issues.join('; ')}`);
  return provided;
}

/** The declared `defaultValue` of every variable the caller did not provide. */
function withDefaults(graph: WorkflowGraph, provided: Record<string, unknown>): Record<string, unknown> {
  const out = { ...provided };
  for (const v of graph.workflow.variables) {
    const current = out[v.name];
    if ((current === undefined || current === null || current === '') && v.defaultValue !== undefined) out[v.name] = v.defaultValue;
  }
  return out;
}

function userVariablesOf(variables: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(variables).filter(([k]) => !FORBIDDEN_VARIABLE_NAME_PATTERN.test(k)));
}

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

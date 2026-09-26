// ────────────────────────────────────────────────────────────────
// SubworkflowEffects — a sub-workflow stage's child run (P05 §4.2).
//
//   start         resolve the child (`workflowRef` by id, or by name in the
//                 parent's project, then global), pin a PUBLISHED version
//                 (`pin_at_run_start`: the current one; a number: that one;
//                 a draft child is refused), re-check the parent's use of
//                 the child's outputs against that version
//                 (`subworkflow_output_drift`), then invoke it through the
//                 ONE invocation service: trigger `{kind: 'stage'}`, the
//                 lineage (depth ≤ 3, recursion refused), the parent's mode
//                 as the ceiling, the stage budget as the run budget, and an
//                 idempotency key per instance (a re-dispatch after a crash
//                 finds the same child). `workspace: inherit` hands the child
//                 the parent's workspace: its mounts and post-processing are
//                 skipped (the parent commits).
//   childCommand  cancel, pause or resume the child (propagation).
//   settled       a child run finalized: its declared `outputs` (evaluated
//                 over its top-level stages) and its usage, for the parent.
// ────────────────────────────────────────────────────────────────

import type { ILogger, WorkflowRun } from '@generatorai/shared';
import { evaluate, parseExpression, validateWorkflow, type InvocationRequest, type RunCommand, type WorkflowGraph, type WorkflowRef } from '@generatorai/workflow-spec';
import type { EngineStores } from '../../domain/ports/IEngineStore.js';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import { expressionScope } from '../../domain/scheduler/readiness.js';
import type { RunMessage, RunOutcome, Usage } from '../../domain/scheduler/types.js';
import { compile } from '../../domain/workflow-graph/compile.js';
import type { RunDefinitionReader } from '../definitions/RunDefinitionReader.js';
import type { WorkflowDefinitionService } from '../WorkflowDefinitionService.js';
import type { WorkflowInvocationService } from '../workflow-invocation/WorkflowInvocationService.js';
import type { InvocationContext } from '../workflow-invocation/types.js';

export interface SubworkflowEffectsDeps {
  stores: EngineStores;
  runRepo: IWorkflowRunRepository;
  definitions: RunDefinitionReader;
  /** A run command on the child (cancel, pause, resume). */
  command: (runId: string, command: RunCommand) => Promise<{ ok: boolean; message?: string }>;
  logger?: ILogger | undefined;
}

export type StartChildResult = { ok: true; childRunId: string } | { ok: false; code: 'subworkflow_start_failed' | 'subworkflow_output_drift'; error: string };

/** The engine's own principal: it holds every scope; the ceiling and the lineage bound what it may start. */
const ENGINE_PRINCIPAL = { kind: 'system', id: 'engine', scopes: [] } as const;

const sameRef = (a: WorkflowRef, b: WorkflowRef) => JSON.stringify(a) === JSON.stringify(b);

export class SubworkflowEffects {
  private invocation?: WorkflowInvocationService;
  private definitionService?: WorkflowDefinitionService;

  constructor(private readonly deps: SubworkflowEffectsDeps) {}

  /** Late wiring: the invocation service is built after the engine (composition root, SDK). */
  setInvocation(invocation: WorkflowInvocationService, definitions: WorkflowDefinitionService): void {
    this.invocation = invocation;
    this.definitionService = definitions;
  }

  async start(runId: string, stageRunId: string, inputs: Record<string, unknown>): Promise<StartChildResult> {
    const fail = (error: string, code: 'subworkflow_start_failed' | 'subworkflow_output_drift' = 'subworkflow_start_failed'): StartChildResult => ({ ok: false, code, error });
    if (!this.invocation || !this.definitionService) return fail('Sub-workflows cannot be started in this process (no invocation service)');
    try {
      const run = await this.deps.runRepo.getById(runId);
      const graph = await this.deps.definitions.get(run.definitionVersionId);
      const inst = this.deps.stores.runStore.loadRunState(runId)?.instances.find((i) => i.id === stageRunId);
      const node = inst ? compile(graph).nodes.get(inst.stageKey) : undefined;
      const stage = inst ? graph.stages.find((s) => s.key === inst.stageKey) : undefined;
      if (!inst || !node?.subworkflow || stage?.kind !== 'subworkflow') return fail(`Instance ${stageRunId} is not a sub-workflow stage`);
      const sub = node.subworkflow;
      const projectId = run.projectId ?? graph.workflow.projectId ?? null;

      // The child, and the published version it runs.
      const child = await this.definitionService.findByRef(sub.ref, projectId);
      const label = 'id' in sub.ref ? `id '${sub.ref.id}'` : `'${sub.ref.name}'`;
      if (!child) return fail(`No workflow ${label} exists`);
      if (child.archivedAt) return fail(`The workflow ${label} is archived`);
      if (child.status !== 'published' || !child.currentVersionId) return fail(`The workflow ${label} is a draft: only a published workflow runs as a sub-workflow`);
      const versions = (await this.definitionService.listVersions(child.id)).filter((v) => v.kind === 'published');
      const pinned = sub.version === 'pin_at_run_start' ? versions.find((v) => v.id === child.currentVersionId) : versions.find((v) => v.version === sub.version);
      if (!pinned) return fail(`The workflow ${label} has no published version ${sub.version === 'pin_at_run_start' ? '' : sub.version}`.trim());
      const childGraph = await this.deps.definitions.get(pinned.id);

      // Output drift: the parent's expressions over the child's outputs, typed from THIS version.
      const drift = outputDrift(graph, sub.ref, { id: child.id, name: child.graph.workflow.name, graph: childGraph, projectId: childGraph.workflow.projectId ?? null });
      if (drift.length > 0) return fail(`The outputs of ${label} version ${pinned.version} no longer fit this workflow: ${drift.join('; ')}`, 'subworkflow_output_drift');

      const request: InvocationRequest = {
        target: { kind: 'definition', workflowDefinitionId: child.id, version: pinned.version },
        variables: inputs,
        name: `${run.name} › ${stage.name}`,
        ...(projectId ? { projectId } : {}),
        ...(budgetOf(stage.budget) ? { budget: budgetOf(stage.budget)! } : {}),
      } as InvocationRequest;
      const ctx: InvocationContext = {
        principal: ENGINE_PRINCIPAL,
        trigger: { kind: 'stage', runId, stageRunId },
        lineage: {
          rootRunId: run.rootRunId ?? run.id,
          parentRunId: run.id,
          parentStageRunId: stageRunId,
          depth: run.depth ?? 0,
          ancestryDefinitionIds: await this.ancestry(run),
        },
        callerPermissionCeiling: (run.effectivePermissionMode ?? run.permissionMode ?? 'default') as NonNullable<InvocationContext['callerPermissionCeiling']>,
        idempotencyKey: `subworkflow:${stageRunId}`,
        ...(sub.workspace === 'inherit' && run.workspaceId ? { inheritWorkspace: { fromRunId: run.id, workspaceId: run.workspaceId } } : {}),
      };
      const result = await this.invocation.invoke(request, ctx);
      return { ok: true, childRunId: result.runId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger?.warn(`[Subworkflow] starting the child of ${stageRunId} failed: ${message}`);
      return fail(message);
    }
  }

  /** Definition ids of the run and every ancestor (recursion is refused against them). */
  private async ancestry(run: WorkflowRun): Promise<string[]> {
    const out = [run.workflowDefinitionId];
    let parentId = run.parentRunId;
    for (let i = 0; parentId && i < 10; i++) {
      const parent = await this.deps.runRepo.getById(parentId).catch(() => null);
      if (!parent) break;
      out.push(parent.workflowDefinitionId);
      parentId = parent.parentRunId;
    }
    return out;
  }

  async childCommand(childRunId: string, command: 'cancel' | 'pause' | 'resume'): Promise<void> {
    const r = await this.deps.command(childRunId, command === 'pause' ? { command, mode: 'drain' } : { command }).catch((err: unknown) => ({ ok: false, message: String(err) }));
    if (!r.ok) this.deps.logger?.info?.(`[Subworkflow] ${command} of child ${childRunId}: ${r.message ?? 'refused'}`);
  }

  /**
   * A child run is terminal: what its parent's sub-workflow stage needs, or
   * null when the run is not a sub-workflow child.
   */
  async settledMessage(childRunId: string): Promise<{ parentRunId: string; msg: Extract<RunMessage, { type: 'child_settled' }> } | null> {
    const child = await this.deps.runRepo.getById(childRunId).catch(() => null);
    if (!child?.parentRunId || !child.parentStageRunId) return null;
    if (child.status !== 'completed' && child.status !== 'failed' && child.status !== 'cancelled') return null;
    const state = this.deps.stores.runStore.loadRunState(childRunId);
    const graph = await this.deps.definitions.get(child.definitionVersionId);
    const outputs: Record<string, unknown> = {};
    if (state) {
      const scope = expressionScope(state.run, state.instances);
      for (const [name, src] of Object.entries(graph.workflow.outputs ?? {})) {
        const parsed = parseExpression(src);
        const r = parsed.ok ? evaluate(parsed.ast, scope) : null;
        outputs[name] = r && r.ok ? r.value : null;
      }
    }
    return {
      parentRunId: child.parentRunId,
      msg: {
        type: 'child_settled',
        stageRunId: child.parentStageRunId,
        childRunId,
        status: child.status as RunOutcome,
        outputs,
        usage: (state?.run.usage ?? {}) as Usage,
        ...(child.error ? { error: child.error } : {}),
      },
    };
  }
}

/** The stage budget as the child run's invocation budget (turns have no run-level equivalent). */
function budgetOf(b: { maxCostUsd?: number; maxTokens?: number; maxWallClockMs?: number } | undefined): InvocationRequest['budget'] | undefined {
  if (!b) return undefined;
  const out: NonNullable<InvocationRequest['budget']> = {};
  if (b.maxCostUsd !== undefined) out.maxCostUsd = b.maxCostUsd;
  if (b.maxTokens !== undefined) out.maxTokens = b.maxTokens;
  if (b.maxWallClockMs !== undefined) out.maxDurationMs = Math.max(10_000, Math.min(86_400_000, b.maxWallClockMs));
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The parent's errors that appear only when `stages.<sub>.output` is typed
 * from the child version about to run (P05 §4.2 output drift).
 */
export function outputDrift(parent: WorkflowGraph, ref: WorkflowRef, child: { id: string; name: string; graph: WorkflowGraph; projectId: string | null }): string[] {
  const key = (i: { code: string; path: string }) => `${i.code}|${i.path}`;
  const before = new Set(validateWorkflow(parent).issues.filter((i) => i.severity === 'error').map(key));
  const after = validateWorkflow(parent, {
    resolveWorkflowRef: (r) => (sameRef(r, ref) ? { ...child, status: 'published' } : undefined),
  }).issues.filter((i) => i.severity === 'error' && i.code.startsWith('expr-') && !before.has(key(i)));
  return after.map((i) => `${i.path}: ${i.message}`);
}

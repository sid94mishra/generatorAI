// The run sheet's request (M8-02; MWorkflowLaunch(+Advanced, +Plan); P04 `POST /workflow-invocations`): which action
// is the filled one (Run for a published workflow, Test run for a draft; Test run is also offered when a published
// workflow has unpublished changes), the options a run takes (variables, per-stage skip / model / variables by
// stage KEY, run-wide model and effort, name, a wall-clock budget, permission mode, codebases with their base ref),
// the one invocation body, the plan preview's layers and setup lines, and the server's issues as lines. Untouched
// options send nothing. Pure, unit-tested.
import { activeStageOverrides, selectedCodebases, type CodebaseDraft, type StageOverrideDraft } from '@generatorai/client-core';
import type { InvocationIssue, InvocationPlan, InvocationRequest, RunPermissionMode } from '@generatorai/workflow-spec';

export interface RunActions {
  /** The filled button. */
  primary: 'run' | 'test';
  /** Test run as a secondary button (a published workflow with unpublished changes). */
  secondaryTest: boolean;
}

export function runActions(record: { status: 'draft' | 'published'; hasUnpublishedChanges: boolean }): RunActions {
  if (record.status === 'draft') return { primary: 'test', secondaryTest: false };
  return { primary: 'run', secondaryTest: record.hasUnpublishedChanges };
}

export interface RunOptions {
  stages: StageOverrideDraft[];
  /** Run-wide model ('' = each stage's own). */
  model: string;
  effort: string;
  name: string;
  /** Wall-clock budget in minutes (0 = none). */
  stopAfterMinutes: number;
  permission: RunPermissionMode | null;
  codebases: CodebaseDraft[];
  /** The project whose codebases the run may mount. */
  projectId: string | null;
}

export const EMPTY_OPTIONS: RunOptions = { stages: [], model: '', effort: '', name: '', stopAfterMinutes: 0, permission: null, codebases: [], projectId: null };

export interface RunDraft {
  variables: Record<string, unknown>;
  test: boolean;
  options?: RunOptions;
}

export function invocationBody(workflowId: string, draft: RunDraft): InvocationRequest {
  const o = draft.options ?? EMPTY_OPTIONS;
  const stageOverrides = activeStageOverrides(o.stages);
  const codebases = o.codebases.length ? selectedCodebases(o.codebases) : null;
  const overrides = {
    ...(o.model ? { model: o.model } : {}),
    ...(o.effort ? { reasoningEffort: o.effort as NonNullable<InvocationRequest['overrides']>['reasoningEffort'] } : {}),
    ...(o.permission ? { permissionMode: o.permission } : {}),
  };
  return {
    target: { kind: 'definition', workflowDefinitionId: workflowId, ...(draft.test ? { testRun: true } : {}) },
    variables: draft.variables,
    ...(o.projectId ? { projectId: o.projectId } : {}),
    // Codebases are sent only when the form offered them (a project with codebases); omitted = the lifecycle's.
    ...(codebases ? { codebases } : {}),
    ...(stageOverrides.length ? { stageOverrides } : {}),
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(o.name.trim() ? { name: o.name.trim() } : {}),
    ...(o.stopAfterMinutes > 0 ? { budget: { maxDurationMs: Math.max(10_000, o.stopAfterMinutes * 60_000) } } : {}),
    client: 'mobile',
  };
}

/** "k of n" stages that run. */
export function stagesIncluded(stages: readonly StageOverrideDraft[]): string {
  return `${stages.filter((s) => !s.skip).length} of ${stages.length}`;
}

export interface PlanLayer {
  layer: number;
  stages: InvocationPlan['stages'];
}

/** Top-level stages by topological layer (L1 = roots). */
export function planLayers(plan: InvocationPlan): PlanLayer[] {
  const top = plan.stages.filter((s) => !s.parentKey);
  const layers = new Map<number, InvocationPlan['stages']>();
  for (const s of top) layers.set(s.layer, [...(layers.get(s.layer) ?? []), s]);
  return [...layers.entries()].sort(([a], [b]) => a - b).map(([layer, stages]) => ({ layer, stages }));
}

export function planHeadline(plan: InvocationPlan): string {
  const layers = planLayers(plan).length;
  const approvals = plan.stages.filter((s) => s.approvalRequired && !s.skipped).length;
  return [`${layers} layer${layers === 1 ? '' : 's'}`, approvals ? `${approvals} approval gate${approvals === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
}

export function planCodebases(plan: InvocationPlan): string | null {
  if (!plan.codebases.length) return null;
  return plan.codebases.map((c) => `${c.alias}${c.baseRef ? ` @ ${c.baseRef}` : ''} · ${c.mode === 'in_place' ? 'in place' : 'worktree'}`).join(', ');
}

/** The server's issues as "path — message" lines (an invocation 400 / 409 carries `error.issues`). */
export function issueLines(error: unknown): string[] {
  const body = (error as { body?: { error?: { issues?: InvocationIssue[] } } } | null)?.body;
  const issues = body?.error?.issues ?? [];
  return issues.filter((i) => i.severity !== 'warning').map((i) => (i.path.length ? `${i.path.join('.')} — ${i.message}` : i.message));
}

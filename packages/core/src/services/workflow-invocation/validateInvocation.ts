// ────────────────────────────────────────────────────────────────
// validateInvocation — everything checked before a run row is written
// (P04 WP-4.2; G4 §1.3.2 step 3):
//
//   scopes          (PD-6) a script target needs `write:workflows`; a
//                   bypass run off loopback and an in-place codebase need
//                   `admin:settings`
//   variables       typed against the definition (moved out of the run
//                   facade); `__*` names never pass (zod already refused them)
//   stage overrides the keys exist
//   codebases       the aliases belong to the project; `requiresCodebase`
//                   with nothing selected is refused (never "all codebases")
//   model           exists in the catalog
//   permission      the ceiling: an explicit request above the caller's
//                   ceiling is refused; the definition's mode is capped by it
//   provider gating (PD-17) the providers can hold the run's mode
//   lineage         depth ≤ MAX_INVOCATION_DEPTH, no recursion
//   budget          the caller has child runs left
//   control flow    (P05) a mount_per_item map needs git-backed codebases;
//                   a sub-workflow's child is published and its outputs
//                   still fit (`subworkflow-output-drift`); several items of
//                   a shared map writing at once is a warning
//   uploads         staged, unexpired, unused, of the declared category
// ────────────────────────────────────────────────────────────────

import type { WorkflowRun } from '@generatorai/shared';
import {
  FORBIDDEN_VARIABLE_NAME_PATTERN,
  MAX_INVOCATION_DEPTH,
  type InvocationIssue,
  type InvocationRequest,
  type RunPermissionMode,
  type RunProfile,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import type { IInvocationUploadRepository } from '../../domain/ports/IInvocationStores.js';
import type { IProjectCodebaseRepository } from '../../domain/ports/IProjectCodebaseRepository.js';
import { InvocationError, issue, type InvocationContext } from './types.js';

/** How much a mode lets through without asking (higher = more). */
export const PERMISSION_ORDER: Readonly<Record<RunPermissionMode, number>> = { plan: 0, default: 1, acceptEdits: 2, bypassPermissions: 3 };

export function minMode(a: RunPermissionMode, b: RunPermissionMode | undefined): RunPermissionMode {
  if (!b) return a;
  return PERMISSION_ORDER[a] <= PERMISSION_ORDER[b] ? a : b;
}

/** The caller's variables checked against the declared ones: types, `required`, choice options. */
export function validateRunVariables(
  graph: WorkflowGraph,
  provided: Record<string, unknown>,
  opts: { partial?: boolean } = {},
): Record<string, unknown> {
  const issues = variableIssues(graph, provided, opts);
  if (issues.length > 0) {
    throw new InvocationError('VALIDATION_ERROR', `Invalid workflow run variables: ${issues.map((i) => i.message).join('; ')}`, issues);
  }
  return withVariableDefaults(graph, provided);
}

function variableIssues(graph: WorkflowGraph, provided: Record<string, unknown>, opts: { partial?: boolean }): InvocationIssue[] {
  const issues: InvocationIssue[] = [];
  for (const k of Object.keys(provided)) {
    if (FORBIDDEN_VARIABLE_NAME_PATTERN.test(k)) {
      issues.push(issue('reserved-variable-name', ['variables', k], `"${k}" is an engine-reserved name (__*, repo_path_*, repo_branch_*)`));
    }
  }
  for (const v of graph.workflow.variables) {
    const raw = provided[v.name];
    const path = ['variables', v.name];
    if (raw === undefined || raw === null || raw === '') {
      if (!opts.partial && v.required && v.defaultValue === undefined) issues.push(issue('variable-required', path, `variable "${v.name}" is required`));
      continue;
    }
    switch (v.type) {
      case 'string':
      case 'text':
        if (typeof raw !== 'string') issues.push(issue('variable-type', path, `variable "${v.name}" must be a string (got ${typeof raw})`));
        break;
      case 'number':
        if (typeof raw !== 'number' || Number.isNaN(raw)) issues.push(issue('variable-type', path, `variable "${v.name}" must be a number (got ${typeof raw})`));
        break;
      case 'boolean':
        if (typeof raw !== 'boolean') issues.push(issue('variable-type', path, `variable "${v.name}" must be a boolean (got ${typeof raw})`));
        break;
      case 'choice':
        if (typeof raw !== 'string') issues.push(issue('variable-type', path, `variable "${v.name}" must be a string (got ${typeof raw})`));
        else if (v.options && v.options.length > 0 && !v.options.includes(raw)) {
          issues.push(issue('variable-choice', path, `variable "${v.name}" must be one of [${v.options.join(', ')}] (got "${raw}")`));
        }
        break;
      case 'list':
        if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) {
          issues.push(issue('variable-type', path, `variable "${v.name}" must be a list of strings`));
        }
        break;
      case 'json':
        break; // any JSON value
    }
  }
  return issues;
}

/** The declared `defaultValue` of every variable the caller did not provide. */
export function withVariableDefaults(graph: WorkflowGraph, provided: Record<string, unknown>): Record<string, unknown> {
  const out = { ...provided };
  for (const v of graph.workflow.variables) {
    const current = out[v.name];
    if ((current === undefined || current === null || current === '') && v.defaultValue !== undefined) out[v.name] = v.defaultValue;
  }
  return out;
}

/** PD-6 / design decision 5: what the request asks for beyond `exec:agent` + `read:workflows`. */
export function checkInvocationScopes(req: InvocationRequest, ctx: InvocationContext): void {
  const scopes = new Set(ctx.principal.scopes);
  if (ctx.principal.kind === 'system') return;
  const need = (scope: string, why: string) => {
    if (!scopes.has(scope)) throw new InvocationError('FORBIDDEN_SCOPE', `${why} needs the ${scope} scope`, [issue('forbidden-scope', [], `${why} needs ${scope}`)]);
  };
  for (const s of ['exec:agent', 'read:workflows']) need(s, 'Starting a workflow run');
  if (req.target.kind === 'script') need('write:workflows', 'Running a workflow script (it materializes a definition)');
  if (req.overrides?.permissionMode === 'bypassPermissions' && !ctx.loopback) need('admin:settings', 'A bypassPermissions run off loopback');
  if (req.codebases?.some((c) => c.mode === 'in_place')) need('admin:settings', 'Editing a codebase in place');
}

export interface ValidationDeps {
  codebases?: IProjectCodebaseRepository | undefined;
  uploads?: IInvocationUploadRepository | undefined;
  /** The model catalog; empty or failing means the check is skipped with a warning. */
  models?: (() => Promise<Array<{ id: string }>>) | undefined;
  /** PD-17: throws when a stage's provider cannot hold the run's mode. */
  permissionGating?: ((run: WorkflowRun, graph: WorkflowGraph) => Promise<void>) | undefined;
  /** The deployment posture (the default mode when nothing is declared). */
  posture: () => RunPermissionMode;
  /** P05 §4.2: issues of the sub-workflow stages' children (a draft child, output drift). */
  subworkflows?: ((graph: WorkflowGraph, projectId: string | null) => Promise<InvocationIssue[]>) | undefined;
  now: () => number;
}

export interface ValidatedInvocation {
  variables: Record<string, unknown>;
  projectId?: string;
  codebases: Array<{ alias: string; baseRef?: string; mode: 'worktree' | 'in_place' }>;
  codebaseSource: 'request' | 'lifecycle';
  stageOverrides: NonNullable<WorkflowRun['stageOverrides']>;
  runOverrides: NonNullable<WorkflowRun['runOverrides']>;
  /** The explicit run mode (the run row), when the request asked for one. */
  permissionMode?: RunPermissionMode;
  /** The trigger's ceiling, kept on the run so definition layers never widen it. */
  permissionCeiling?: RunPermissionMode;
  /** What the run will run under (for the plan). */
  effectivePermissionMode: RunPermissionMode;
  budget?: Record<string, unknown>;
  lineage: { depth: number; rootRunId?: string; parentRunId?: string; parentStageRunId?: string };
  uploads: Array<{ uploadId: string; category: 'skills' | 'agents' | 'prompts' }>;
  name?: string;
  warnings: InvocationIssue[];
}

/**
 * Validate a parsed request against its resolved target. Throws
 * `InvocationError` with every issue found; warnings ride along in the result.
 */
export async function validateInvocation(
  req: InvocationRequest,
  ctx: InvocationContext,
  target: { workflowDefinitionId: string; graph: WorkflowGraph; profile?: RunProfile | undefined; fork?: WorkflowRun | undefined },
  deps: ValidationDeps,
): Promise<ValidatedInvocation> {
  const { graph, profile } = target;
  const issues: InvocationIssue[] = [];
  const warnings: InvocationIssue[] = [];

  // A script profile sits under the request.
  const variables = { ...(profile?.variables ?? {}), ...req.variables };
  const stageOverridesIn = [...(profile?.stageOverrides ?? []), ...(req.stageOverrides ?? [])];
  const overridesIn = { ...(profile?.overrides ?? {}), ...(req.overrides ?? {}) };

  // ── variables (a fork validates the merged set itself) ──
  if (!target.fork) issues.push(...variableIssues(graph, variables, {}));

  // ── stage overrides ──
  const keys = new Set(graph.stages.map((s) => s.key));
  const byKey = new Map<string, NonNullable<WorkflowRun['stageOverrides']>[number]>();
  stageOverridesIn.forEach((o, i) => {
    if (!keys.has(o.stageKey)) {
      issues.push(issue('unknown-stage', ['stageOverrides', i, 'stageKey'], `"${o.stageKey}" is not a stage of this workflow`));
      return;
    }
    const prev = byKey.get(o.stageKey) ?? { stageKey: o.stageKey };
    byKey.set(o.stageKey, {
      ...prev,
      ...(o.skip !== undefined ? { skip: o.skip } : {}),
      ...(o.variables ? { variables: { ...(prev.variables ?? {}), ...o.variables } } : {}),
      ...(o.model ? { model: o.model } : {}),
    });
  });

  // ── codebases (W-22: never "all codebases") ──
  const projectId = req.projectId ?? profile?.projectId ?? target.fork?.projectId ?? graph.workflow.projectId ?? undefined;
  const requested = req.codebases ?? profile?.codebases;
  const codebaseSource: 'request' | 'lifecycle' = requested ? 'request' : 'lifecycle';
  const mode = graph.workflow.lifecycle.useWorktree ? 'worktree' : 'in_place';
  const codebases = requested
    ? requested.map((c) => ({ alias: c.alias, ...(c.baseRef ? { baseRef: c.baseRef } : {}), mode: c.mode }))
    : (target.fork?.codebaseSelection ?? graph.workflow.lifecycle.codebaseAliases.map((alias) => ({ alias, mode })));
  if (codebases.length > 0) {
    if (!projectId) {
      issues.push(issue('codebase-without-project', ['codebases'], 'Codebases need a project: pass projectId or run a project workflow'));
    } else if (deps.codebases) {
      for (const [i, c] of codebases.entries()) {
        const cb = await deps.codebases.getByAlias(projectId, c.alias);
        if (!cb) issues.push(issue('unknown-codebase', ['codebases', i, 'alias'], `"${c.alias}" is not a codebase of the project`));
        else if (cb.status !== 'ready') issues.push(issue('codebase-not-ready', ['codebases', i, 'alias'], `Codebase "${c.alias}" is ${cb.status}`));
      }
    }
  }
  // P05 §4.1: item worktrees are cut from git commits of the run mounts.
  const perItemMaps = graph.stages.filter((s) => s.kind === 'map' && s.map.workspace === 'mount_per_item').map((s) => s.key);
  if (perItemMaps.length > 0 && projectId && deps.codebases) {
    for (const [i, c] of codebases.entries()) {
      const cb = await deps.codebases.getByAlias(projectId, c.alias);
      if (cb && cb.type === 'local-dir') {
        issues.push(
          issue('map-mount-per-item-git', ['codebases', i, 'alias'], `"${c.alias}" is not a git repository; the map(s) ${perItemMaps.join(', ')} cut a worktree per item (mount_per_item)`),
        );
      }
    }
  }
  if (codebases.length === 0 && graph.workflow.lifecycle.requiresCodebase) {
    throw new InvocationError('CODEBASE_REQUIRED', 'This workflow requires at least one codebase; select one', [
      issue('codebase-required', ['codebases'], 'Select at least one codebase'),
    ]);
  }

  // ── models ──
  const models = [overridesIn.model, ...[...byKey.values()].map((o) => o.model)].filter((m): m is string => !!m);
  if (models.length > 0 && deps.models) {
    const catalog = await deps.models().catch(() => []);
    if (catalog.length === 0) warnings.push(issue('model-catalog-unavailable', ['overrides', 'model'], 'The model catalog is unavailable; model names were not checked', 'warning'));
    else {
      const ids = new Set(catalog.map((m) => m.id));
      for (const m of new Set(models)) if (!ids.has(m)) issues.push(issue('unknown-model', ['overrides', 'model'], `"${m}" is not a model of any provider`));
    }
  }

  // ── lineage and budget ──
  const lineage = ctx.lineage
    ? {
        depth: ctx.lineage.depth + 1,
        rootRunId: ctx.lineage.rootRunId,
        ...(ctx.lineage.parentRunId ? { parentRunId: ctx.lineage.parentRunId } : {}),
        ...(ctx.lineage.parentStageRunId ? { parentStageRunId: ctx.lineage.parentStageRunId } : {}),
      }
    : { depth: 0 };
  if (lineage.depth > MAX_INVOCATION_DEPTH) {
    throw new InvocationError('DEPTH_LIMIT', `Runs nest at most ${MAX_INVOCATION_DEPTH} deep`, [issue('depth-limit', [], `depth ${lineage.depth} > ${MAX_INVOCATION_DEPTH}`)]);
  }
  if (ctx.lineage?.ancestryDefinitionIds.includes(target.workflowDefinitionId)) {
    throw new InvocationError('RECURSION', 'A workflow cannot invoke itself (directly or through its ancestors)', [
      issue('recursion', ['target'], `${target.workflowDefinitionId} is an ancestor of this run`),
    ]);
  }
  if (ctx.budget?.remainingChildRuns !== undefined && ctx.budget.remainingChildRuns <= 0) {
    throw new InvocationError('BUDGET_EXHAUSTED', 'The caller has no child runs left in its budget', [issue('budget-exhausted', ['budget'], 'maxChildRuns reached')]);
  }

  // ── uploads ──
  const uploads = req.uploads ?? [];
  if (uploads.length > 0) {
    if (!deps.uploads) issues.push(issue('uploads-unavailable', ['uploads'], 'Uploads are not available in this process'));
    else {
      for (const [i, u] of uploads.entries()) {
        const rec = await deps.uploads.get(u.uploadId);
        const path = ['uploads', i, 'uploadId'];
        if (!rec) issues.push(issue('unknown-upload', path, `Upload ${u.uploadId} does not exist`));
        else if (rec.consumedByRunId) issues.push(issue('upload-used', path, `Upload ${u.uploadId} was used by another run`));
        else if (rec.expiresAt.getTime() < deps.now()) issues.push(issue('upload-expired', path, `Upload ${u.uploadId} expired`));
        else if (rec.category !== u.category) issues.push(issue('upload-category', path, `Upload ${u.uploadId} is a ${rec.category} file, not ${u.category}`));
      }
    }
  }

  if (issues.length > 0) {
    throw new InvocationError('VALIDATION_ERROR', issues.map((i) => i.message).join('; '), issues);
  }

  // ── permission ceiling ──
  const requestedMode = overridesIn.permissionMode;
  const ceiling = ctx.callerPermissionCeiling;
  if (requestedMode && ceiling && PERMISSION_ORDER[requestedMode] > PERMISSION_ORDER[ceiling]) {
    throw new InvocationError('PERMISSION_ESCALATION', `The caller may grant at most '${ceiling}'; '${requestedMode}' was asked for`, [
      issue('permission-escalation', ['overrides', 'permissionMode'], `above the caller ceiling '${ceiling}'`),
    ]);
  }
  const explicit = requestedMode ?? (target.fork?.permissionMode as RunPermissionMode | undefined);
  const declared = graph.workflow.session.permissionMode as RunPermissionMode | undefined;
  const effectivePermissionMode = explicit ?? minMode(declared ?? deps.posture(), ceiling);

  const runOverrides: NonNullable<WorkflowRun['runOverrides']> = {
    ...(overridesIn.model ? { model: overridesIn.model } : {}),
    ...(overridesIn.harnessType ? { harnessType: overridesIn.harnessType } : {}),
    ...(overridesIn.reasoningEffort ? { reasoningEffort: overridesIn.reasoningEffort } : {}),
  };

  // ── P05 §1.2: a check stage runs repository code (the run capability `shell`) ──
  const checks = graph.stages.filter((s) => s.kind === 'check').map((s) => s.key);
  if (checks.length > 0 && effectivePermissionMode === 'plan') {
    throw new InvocationError('PERMISSION_ESCALATION', `A run in plan mode cannot run commands; the check stage(s) ${checks.join(', ')} would run repository code`, [
      issue('shell-in-plan-mode', ['overrides', 'permissionMode'], `check stages (${checks.join(', ')}) need a mode above plan`),
    ]);
  }

  // ── PD-17: can the providers hold the mode? ──
  if (deps.permissionGating) {
    const probe = {
      id: 'plan',
      workflowDefinitionId: target.workflowDefinitionId,
      definitionVersionId: '',
      name: '',
      status: 'created',
      variables,
      ...(explicit ? { permissionMode: explicit } : {}),
      ...(ceiling ? { systemVars: { triggerPermissionMode: ceiling } } : {}),
      ...(projectId ? { projectId } : {}),
      createdAt: new Date(deps.now()),
      updatedAt: new Date(deps.now()),
    } as WorkflowRun;
    try {
      await deps.permissionGating(probe, graph);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new InvocationError('PERMISSION_GATING_UNSUPPORTED', message, [issue('permission-gating', ['overrides', 'permissionMode'], message)]);
    }
  }

  // ── budget: the request's over the workflow's ──
  const wf = graph.workflow.budget;
  const b = req.budget ?? profile?.budget;
  const budget =
    wf || b
      ? {
          ...(wf ?? {}),
          ...(b?.maxDurationMs !== undefined ? { maxWallClockMs: b.maxDurationMs } : {}),
          ...(b?.maxCostUsd !== undefined ? { maxCostUsd: b.maxCostUsd } : {}),
          ...(b?.maxTokens !== undefined ? { maxTokens: b.maxTokens } : {}),
          ...(b?.maxChildRuns !== undefined ? { maxChildRuns: b.maxChildRuns } : {}),
        }
      : undefined;

  // ── P05 §4.2: sub-workflow children (published, outputs still fitting) ──
  if (deps.subworkflows) issues.push(...(await deps.subworkflows(graph, projectId ?? null)));
  if (issues.length > 0) throw new InvocationError('VALIDATION_ERROR', issues.map((i) => i.message).join('; '), issues);

  // ── warnings ──
  // P05 §4.1: several items of a shared map at once, with a body that may write.
  for (const s of graph.stages) {
    if (s.kind !== 'map' || s.map.workspace !== 'shared' || s.map.concurrency <= 1) continue;
    const writers = graph.stages.filter((b) => {
      let p = b.parentKey;
      while (p !== undefined && p !== s.key) p = graph.stages.find((x) => x.key === p)?.parentKey;
      if (p !== s.key) return false;
      if (b.kind === 'check') return true;
      if (b.kind !== 'agent') return false;
      const mode = b.session?.permissionMode ?? (explicit === 'plan' ? 'plan' : undefined) ?? effectivePermissionMode;
      return mode !== 'plan';
    });
    if (writers.length > 0) {
      warnings.push(
        issue('map-shared-write-concurrency', ['target'], `The map "${s.key}" runs ${s.map.concurrency} items at once in one shared workspace, and "${writers[0]!.key}" may write to it (run mode ${effectivePermissionMode})`, 'warning'),
      );
    }
  }
  const groups = new Map<string, Set<string>>();
  for (const s of graph.stages) {
    if (s.kind !== 'agent' || !s.sessionGroup) continue;
    const model = byKey.get(s.key)?.model ?? s.session?.model ?? runOverrides.model ?? graph.workflow.session.model ?? '';
    const set = groups.get(s.sessionGroup) ?? new Set<string>();
    set.add(model);
    groups.set(s.sessionGroup, set);
  }
  for (const [group, set] of groups) {
    if (set.size > 1) {
      warnings.push(issue('session-group-rebinding', ['stageOverrides'], `Stages of session group "${group}" run on different models; the shared conversation is re-bound between them`, 'warning'));
    }
  }
  if (explicit === undefined && ceiling && declared && PERMISSION_ORDER[declared] > PERMISSION_ORDER[ceiling]) {
    warnings.push(issue('permission-capped', ['overrides', 'permissionMode'], `The workflow's '${declared}' is capped to '${ceiling}' by the caller`, 'warning'));
  }

  return {
    variables: target.fork ? variables : withVariableDefaults(graph, variables),
    ...(projectId ? { projectId } : {}),
    codebases,
    codebaseSource,
    stageOverrides: [...byKey.values()],
    runOverrides,
    ...(requestedMode ? { permissionMode: requestedMode } : {}),
    ...(ceiling ? { permissionCeiling: ceiling } : {}),
    effectivePermissionMode,
    ...(budget ? { budget } : {}),
    lineage,
    uploads,
    ...((req.name ?? profile?.runName) ? { name: req.name ?? profile?.runName } : {}),
    warnings,
  };
}

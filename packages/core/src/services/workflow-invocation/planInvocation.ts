// ────────────────────────────────────────────────────────────────
// planInvocation — what a validated invocation will do (P04 WP-4.2; G4
// §1.3.4): the stages by topological layer, which are skipped (by an
// override, or a guard that is statically false over the variables), each
// stage's model / provider / agent, the codebases, the prepare phases with
// work to do, the pre- and post-processing steps, the permission mode and
// the lineage. Pure: nothing is read or written.
// ────────────────────────────────────────────────────────────────

import {
  analyzeGraph,
  evaluateSource,
  type InvocationPlan,
  type PreparePhase,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import { buildPostProcessingSteps } from '../engine/lifecycle/finalize.js';
import type { ValidatedInvocation } from './validateInvocation.js';

export function planInvocation(
  target: { workflowDefinitionId: string; definitionVersionId: string | null; graph: WorkflowGraph },
  v: ValidatedInvocation,
  opts: { sandbox?: boolean; projectConfigs?: boolean } = {},
): InvocationPlan {
  const { graph } = target;
  const layerOf = new Map<string, number>();
  analyzeGraph(
    graph.stages.map((s) => s.key),
    graph.edges,
  ).layers.forEach((layer, i) => {
    for (const key of layer) layerOf.set(key, i);
  });
  const overrides = new Map(v.stageOverrides.map((o) => [o.stageKey, o]));

  const stages = graph.stages.map((s) => {
    const o = overrides.get(s.key);
    const session = s.kind === 'agent' ? s.session : undefined;
    let skipReason: 'override' | 'guard_false' | undefined = o?.skip ? 'override' : undefined;
    if (!skipReason && s.guard) {
      // Only a guard over variables alone is decided now; one that reads stages waits for the run.
      const r = evaluateSource(s.guard, { variables: v.variables });
      if (r.ok && r.value === false) skipReason = 'guard_false';
    }
    const model = o?.model ?? session?.model ?? v.runOverrides.model ?? graph.workflow.session.model;
    const harnessType = session?.harnessType ?? v.runOverrides.harnessType ?? graph.workflow.session.harnessType;
    const agentRef = session?.agentRef ?? graph.workflow.session.agentRef;
    return {
      key: s.key,
      name: s.name,
      layer: layerOf.get(s.key) ?? 0,
      skipped: skipReason !== undefined,
      ...(skipReason ? { skipReason } : {}),
      ...(model ? { model } : {}),
      ...(harnessType ? { harnessType } : {}),
      ...(agentRef ? { agentRef } : {}),
      approvalRequired: s.kind === 'agent' && !!s.approval,
      kind: s.kind,
      ...(s.parentKey ? { parentKey: s.parentKey } : {}),
    };
  });
  const checks = graph.stages.filter((s) => s.kind === 'check');
  const risks: InvocationPlan['risks'] = checks.length
    ? [
        {
          code: 'runs_repo_code',
          stageKeys: checks.map((s) => s.key),
          message: `Runs repository code: ${checks.map((s) => (s.kind === 'check' ? `${s.key} (${[s.check.command, ...s.check.args].join(' ')})` : s.key)).join('; ')}`,
        },
      ]
    : [];

  const lifecycle = graph.workflow.lifecycle;
  const prepare: PreparePhase[] = ['workspace', 'worktrees'];
  if (v.uploads.length > 0) prepare.push('uploads');
  if (opts.projectConfigs && v.projectId) prepare.push('projectConfigs');
  if (lifecycle.preprocessingSteps.length > 0) prepare.push('preprocess');
  if (opts.sandbox) prepare.push('sandbox');

  return {
    workflowDefinitionId: target.workflowDefinitionId,
    definitionVersionId: target.definitionVersionId,
    workflowName: graph.workflow.name,
    stages,
    codebases: v.codebases.map((c) => ({ alias: c.alias, baseRef: c.baseRef ?? null, mode: c.mode, source: v.codebaseSource })),
    prepare,
    preprocessing: lifecycle.preprocessingSteps.map((s) => s.name),
    postProcessing: buildPostProcessingSteps(lifecycle, v.codebases.length > 0).map((s) => s.name),
    permissionMode: v.effectivePermissionMode,
    lineage: { depth: v.lineage.depth, rootRunId: v.lineage.rootRunId ?? null, parentRunId: v.lineage.parentRunId ?? null },
    warnings: opts.sandbox
      ? [
          ...v.warnings,
          { code: 'sandbox-not-used', path: ['target'], message: 'The run provisions a sandbox, but its stages run on the host: sessions are not routed through it yet', severity: 'warning' as const },
        ]
      : v.warnings,
    risks,
  };
}

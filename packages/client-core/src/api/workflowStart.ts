// ────────────────────────────────────────────────────────────────
// Which start route a workflow run needs (web and mobile share this).
//
// `POST /api/workflow-runs` creates and starts a bare run. The
// orchestrator route (`POST /api/orchestrator/runs`) also prepares the
// project workspace, mounts codebases and runs the lifecycle's pre- and
// post-processing. A workflow needs it when it belongs to a project or its
// lifecycle has any of that work to do.
// ────────────────────────────────────────────────────────────────

import type { WorkflowGraph } from '@generatorai/workflow-spec';

export function needsOrchestratedStart(workflow: Pick<WorkflowGraph['workflow'], 'lifecycle' | 'projectId'>): boolean {
  const l = workflow.lifecycle;
  const post = l.postProcessing;
  return (
    !!workflow.projectId ||
    l.requiresCodebase ||
    l.codebaseAliases.length > 0 ||
    l.preprocessingSteps.length > 0 ||
    post.autoCommit ||
    post.autoPush ||
    post.autoCreatePR ||
    post.steps.length > 0
  );
}

// ────────────────────────────────────────────────────────────────
// Workflow risk flags as every client shows them (P06 WP-6.5): the label of
// each flag `riskFlags(graph)` reports (the list describe_workflow gives an
// agent) and the flags drawn as danger (err tone) rather than a warning —
// the builder's agent-draft card and the chat's workflow cards read both.
// ────────────────────────────────────────────────────────────────

import type { RiskFlag } from '@generatorai/workflow-spec';

export const RISK_LABELS: Record<RiskFlag, string> = {
  writes_files: 'Writes files',
  commits: 'Commits',
  pushes: 'Pushes',
  opens_pr: 'Opens a pull request',
  bypass_permissions: 'Bypasses permission prompts',
  runs_repo_code: "Runs the repository's code",
  starts_other_workflows: 'Starts other workflows',
  uses_workflow_tools: 'An agent can run or author workflows',
  worktree_per_item: 'A worktree per item',
  plans_stages_at_run_time: 'An agent plans stages at run time',
};

/** Flags shown with danger styling: they reach outside the workspace or skip the permission prompts. */
export const DANGER: ReadonlySet<RiskFlag> = new Set<RiskFlag>(['pushes', 'opens_pr', 'bypass_permissions']);

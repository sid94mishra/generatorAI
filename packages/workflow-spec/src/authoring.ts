// ────────────────────────────────────────────────────────────────
// Wire shapes of agent integration (P06): what the authoring routes and
// tools answer, a chat's run cards, and the workflow tool adverts the MCP
// server lists. Shared by the server, every client and the MCP server.
// ────────────────────────────────────────────────────────────────

import { collectCommandFields } from './commandBearing.js';
import type { WorkflowGraph } from './schemas/graph.js';
import type { InvocationPlan } from './schemas/invocation.js';
import type { ValidationIssue } from './validate/issues.js';

/** `POST /workflow-definitions/validate`, `validate_workflow`. */
export interface AuthoringValidation {
  valid: boolean;
  issues: ValidationIssue[];
  /** The schema the server validated against; compare with the skill's `schemaHash`. */
  schema: { version: number; hash: string | null };
}

/** `POST /workflow-definitions/plan`, `plan_workflow`. */
export interface AuthoringPlan {
  plan: InvocationPlan;
  /** Guards decided before the run (over variables alone): stage key → true / false. Undecided guards are absent. */
  guards: Record<string, boolean>;
  /** `variables.<name>` read by a prompt or expression, with no value given and no default. */
  unresolved: string[];
  /** Validation warnings (capability conflicts and the like). */
  warnings: ValidationIssue[];
}

/** `create_workflow_draft`. */
export interface DraftResult {
  workflowId: string;
  status: 'draft';
  name: string;
  reviewLink: string;
  warnings: ValidationIssue[];
}

/** `GET /workflow-definitions/schema`. */
export interface WorkflowSchemaInfo {
  version: number;
  hash: string | null;
  jsonSchema: Record<string, unknown> | null;
}

/** `GET /workflow-definitions/authoring/skill`. */
export interface AuthoringSkillIndex {
  name: string;
  schemaHash: string | null;
  files: string[];
}

/** A run a chat started, as its card draws it (`GET /chats/:id/workflow-runs`). */
export interface ChatWorkflowRunCard {
  runId: string;
  workflowId: string;
  workflowName: string;
  toolCallId: string | null;
  status: string;
  currentStage?: string;
  stagesDone: number;
  stagesTotal: number;
  pendingApprovals: Array<{ instanceId: string; stageKey: string; stageName: string; decision: string; answerableByAgent: boolean }>;
  /** Once finalized: the last stage summary (or the error), at most 600 characters. */
  summary?: string;
  /** Once finalized: the pull request post-processing opened. */
  prUrl?: string;
  link: string;
  createdAt: string;
}

/** One workflow tool as `GET /workflow-tools` lists it (the MCP server advertises these). */
export interface WorkflowToolAdvert {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  readOnly: boolean;
}

/** The skill bundle's name, its resource URI prefix and the topics of the guide. */
export const WORKFLOW_AUTHOR_SKILL = 'generatorai-workflow-author';
export const WORKFLOW_AUTHOR_RESOURCE_PREFIX = 'generatorai://workflow-author/';

/** What a workflow may do that a person should see before it runs or is published (describe_workflow, the agent-draft banner). */
export const RISK_FLAGS = [
  'writes_files',
  'commits',
  'pushes',
  'opens_pr',
  'bypass_permissions',
  'runs_repo_code',
  'starts_other_workflows',
  'uses_workflow_tools',
  'worktree_per_item',
  'plans_stages_at_run_time',
] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];

/** What a run of this workflow may do that deserves a look before starting it. */
export function riskFlags(graph: WorkflowGraph): RiskFlag[] {
  const wf = graph.workflow;
  const flags = new Set<RiskFlag>();
  const writer = graph.stages.some((s) => s.kind === 'agent' && (s.session?.permissionMode ?? wf.session.permissionMode) !== 'plan');
  if (writer) flags.add('writes_files');
  const pp = wf.lifecycle.postProcessing;
  if (pp.autoCommit || pp.autoPush || pp.autoCreatePR || pp.steps.some((s) => s.config.type === 'commit_and_push')) flags.add('commits');
  if (pp.autoPush || pp.autoCreatePR || pp.steps.some((s) => s.config.type === 'commit_and_push' && s.config.push)) flags.add('pushes');
  if (pp.autoCreatePR || pp.steps.some((s) => s.config.type === 'create_pr')) flags.add('opens_pr');
  if ((wf.session.permissionMode ?? '') === 'bypassPermissions' || graph.stages.some((s) => s.kind === 'agent' && s.session?.permissionMode === 'bypassPermissions')) {
    flags.add('bypass_permissions');
  }
  // Every command-bearing field: checks, scripts, script and function hooks,
  // stdio MCP servers, custom_script rules, BYOK providers and the rest of
  // the privileged registry (final review AGENT R6).
  if (collectCommandFields(graph).length > 0) flags.add('runs_repo_code');
  if (graph.stages.some((s) => s.kind === 'subworkflow')) flags.add('starts_other_workflows');
  // Workflow tools let a stage's agent start, answer or author workflows.
  const grantsWorkflowTools = (t: { workflows?: boolean; workflowAuthoring?: boolean } | undefined) =>
    t?.workflows === true || t?.workflowAuthoring === true;
  if (
    grantsWorkflowTools(wf.session.agentOverrides?.tools) ||
    graph.stages.some((s) => s.kind === 'agent' && grantsWorkflowTools(s.session?.agentOverrides?.tools))
  ) {
    flags.add('uses_workflow_tools');
  }
  if (graph.stages.some((s) => s.kind === 'map' && s.map.workspace === 'mount_per_item')) flags.add('worktree_per_item');
  if (graph.stages.some((s) => s.kind === 'agent' && s.expands)) flags.add('plans_stages_at_run_time');
  return [...flags];
}

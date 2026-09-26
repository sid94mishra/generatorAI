// ────────────────────────────────────────────────────────────────
// Wire shapes of agent integration (P06): what the authoring routes and
// tools answer, a chat's run cards, and the workflow tool adverts the MCP
// server lists. Shared by the server, every client and the MCP server.
// ────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────
// StageDefinition + StageEdge — Units of work within a Workflow DAG
// ────────────────────────────────────────────────────────────────

import type { HarnessConfig } from './Workflow.js';
import type { BrowserConfig } from './BrowserSession.js';
import type { HookDefinition } from './HookDefinition.js';
import type { ResultValidationRule } from './WorkflowOrchestrator.js';
import type { AgentMode } from './AgentMode.js';

/** A single prompt to send within a stage */
export interface PromptDefinition {
  label: string;
  text: string;
  waitForCompletion: boolean;
}

/** Retry policy for failed stages */
export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
}

/** Condition for running or skipping a stage */
export interface StageCondition {
  type: 'always' | 'on_success' | 'on_failure' | 'expression';
  expression?: string;
}

/** Controls what context from predecessor stages is injected */
export type ContextFilter = 'full' | 'summary-only' | 'none' | 'structured';

/** Configuration for iteration-based sub-workflow execution */
export interface IterationConfig {
  /** ID of the workflow definition to run as sub-workflow */
  subWorkflowDefinitionId: string;
  /** Map parent variables → sub-workflow input variables */
  inputMapping: Record<string, string>;
  /** Map sub-workflow output → parent stage variables */
  outputMapping: Record<string, string>;
  /** Value in sub-workflow's final stage output_data that signals "done" */
  exitValue?: string;
  /** Field in output_data to check for exit signal (default: "status") */
  exitField?: string;
  /** Max iterations before forced exit (safety cap) */
  maxIterations: number;
}

/** Artifact manifest entry — describes a file produced by a stage */
export interface ArtifactManifestEntry {
  path: string;
  language: string;
  action: 'created' | 'modified';
  sizeBytes: number;
}

/** Skill reference for stage-level configuration */
export interface StageSkillReference {
  name: string;
  directory?: string;
  description?: string;
}

/** StageDefinition domain entity */
export interface StageDefinition {
  id: string;
  workflowDefinitionId: string;
  name: string;
  description?: string;
  templateId?: string;
  order: number;
  prompts: PromptDefinition[];
  /** Agent harness config overrides for this stage (provider-agnostic) */
  harnessConfigOverrides?: Partial<HarnessConfig>;
  variables: Record<string, unknown>;
  hooks: HookDefinition[];
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
  condition?: StageCondition;
  /** Controls what predecessor context is injected (default: 'summary-only') */
  contextFilter?: ContextFilter;
  /**
   * Explicit list of stage names to pull context from.
   * If defined, only these stages' outputs are injected (regardless of DAG edges).
   * If undefined, falls back to direct DAG predecessors.
   * If empty array [], no context is injected.
   */
  contextSources?: string[];
  /**
   * Output format for this stage:
   * - 'text': stage produces a text summary (extracted via LLM summary prompt)
   * - 'json': stage must produce a JSON code block matching outputSchema
   * Default: 'text'
   */
  outputFormat?: 'text' | 'json';
  /** Portable `scope:slug` ref of the agent driving this stage. */
  agentRef?: string;
  /** Skills specifically for this stage */
  skills?: StageSkillReference[];
  /** Per-stage result validation rules (evaluated after stage completes) */
  resultValidation?: ResultValidationRule[];
  /** Human-readable description of expected output — appended to final prompt */
  expectedOutput?: string;
  /** JSON Schema to extract and validate structured output from LLM response */
  outputSchema?: Record<string, unknown>;
  /** Configuration for iteration-based sub-workflow execution */
  iterationConfig?: IterationConfig;
  /**
   * When true, the stage pauses in `awaiting_input` after its work and hooks
   * complete so a human can review the output before the workflow advances.
   * The reviewer may Approve (stage → completed, DAG advances) or provide
   * feedback that is sent as a follow-up prompt to the same session. Default
   * `false` — stages auto-advance as before.
   */
  approvalRequired?: boolean;
  /**
   * How the agent should behave for this stage's prompts.
   *
   * - `auto` (default) — the agent implements directly. If the prompt asks for
   *   a plan it still records one (non-blocking) and carries on.
   * - `plan` — the agent produces a plan first. Combined with
   *   {@link approvalRequired} the plan BLOCKS for human approval exactly like
   *   a chat; without it the plan is recorded and the stage proceeds.
   *
   * Behaviour is resolved from `AGENT_MODE_REGISTRY`, so new modes need no
   * change here.
   */
  agentMode?: AgentMode;
  /**
   * Integrated Browser overrides for this stage. Deep-merged on top of the
   * workflow-level `browserConfig`. Use this to enable a browser session for
   * a specific stage without turning it on for the whole workflow.
   */
  browserConfig?: BrowserConfig;
  createdAt: Date;
}

/** Dependency edge type between stages */
export type StageEdgeType = 'on_success' | 'on_failure' | 'on_completion' | 'always';

/** StageEdge domain entity — DAG dependency link */
export interface StageEdge {
  id: string;
  workflowDefinitionId: string;
  fromStageId: string;
  toStageId: string;
  edgeType: StageEdgeType;
}

/** Parameters for creating a new StageDefinition */
export interface CreateStageParams {
  workflowDefinitionId: string;
  name: string;
  description?: string;
  templateId?: string;
  order?: number;
  prompts?: PromptDefinition[];
  harnessConfigOverrides?: Partial<HarnessConfig>;
  variables?: Record<string, unknown>;
  hooks?: HookDefinition[];
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
  condition?: StageCondition;
  contextFilter?: ContextFilter;
  /** Portable `scope:slug` ref of the agent driving this stage. `null` clears it. */
  agentRef?: string | null;
  skills?: StageSkillReference[];
  resultValidation?: ResultValidationRule[];
  expectedOutput?: string;
  outputSchema?: Record<string, unknown>;
  iterationConfig?: IterationConfig;
  contextSources?: string[];
  outputFormat?: 'text' | 'json';
  approvalRequired?: boolean;
  /** Per-stage agent mode (see StageDefinition.agentMode). */
  agentMode?: AgentMode;
  /** Integrated Browser overrides for this stage (deep-merged with workflow-level). */
  browserConfig?: BrowserConfig;
}

/** Parameters for creating a new StageEdge */
export interface CreateEdgeParams {
  workflowDefinitionId: string;
  fromStageId: string;
  toStageId: string;
  edgeType?: StageEdgeType;
}

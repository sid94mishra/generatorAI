// ────────────────────────────────────────────────────────────────
// Builder Types — Type definitions for the Workflow Script Builder SDK
// ────────────────────────────────────────────────────────────────

import type { HarnessConfig } from '../types/Workflow.js';
import type {
  VariableDefinition,
  SkillReference,
  AgentReference,
  WorkflowSessionMode,
} from '../types/WorkflowDefinition.js';
import type { WorkflowRunPermissionMode } from '../types/WorkflowRun.js';
import type {
  PromptDefinition,
  RetryPolicy,
  StageCondition,
  StageEdgeType,
  ContextFilter,
  StageSkillReference,
  IterationConfig,
} from '../types/StageDefinition.js';
import type {
  HookPhase,
  HookType,
  HookFailurePolicy,
  HookConfig,
  HookResult,
  WorkflowHookPhase,
} from '../types/HookDefinition.js';
import type {
  OrchestratorConfig,
  PreprocessingStep,
  StageResultValidation,
} from '../types/WorkflowOrchestrator.js';

// ── Hook Handler Signatures ──

/** Handler function for workflow-level hooks defined inline in scripts. */
export type WorkflowHookHandler = (ctx: WorkflowHookHandlerContext) => Promise<HookResult | void>;

/** Context passed to inline workflow hook handlers. */
export interface WorkflowHookHandlerContext {
  workflowId: string;
  runId: string;
  variables: Record<string, unknown>;
  signal: AbortSignal;
}

/** Handler function for stage-level hooks defined inline in scripts. */
export type StageHookHandler = (ctx: StageHookHandlerContext) => Promise<HookResult | void>;

/** Context passed to inline stage hook handlers. */
export interface StageHookHandlerContext {
  workflowId: string;
  runId: string;
  stageId: string;
  stageName: string;
  variables: Record<string, unknown>;
  signal: AbortSignal;
}

// ── Hook Definition Config (simplified for builder) ──

/** Declarative hook config for use in the builder API. */
export interface HookDefinitionConfig {
  type: HookType;
  /** For script hooks */
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** For http hooks */
  url?: string;
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  bodyTemplate?: string;
  /** For function hooks */
  modulePath?: string;
  handlerName?: string;
  handlerArgs?: Record<string, unknown>;
  /** Common hook options */
  name?: string;
  priority?: number;
  failurePolicy?: HookFailurePolicy;
  timeoutMs?: number;
  retries?: number;
}

// ── Variable Config (simplified for builder) ──

/** Variable configuration for use in the builder API. */
export interface VariableConfig {
  type: 'string' | 'number' | 'boolean' | 'choice' | 'text' | 'git_url' | 'git_urls';
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: unknown;
  options?: string[];
}

// ── MCP Server Config ──

export interface McpServerBuilderConfig {
  type: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
}

// ── Stage Output ──

export interface StageOutput {
  localId: string;
  config: {
    name: string;
    description?: string;
    order: number;
    prompts: PromptDefinition[];
    hooks?: Array<{
      id: string;
      name: string;
      phase: HookPhase;
      type: HookType;
      priority: number;
      enabled: boolean;
      failurePolicy: HookFailurePolicy;
      timeoutMs: number;
      retries: number;
      config: HookConfig;
    }>;
    variables?: Record<string, unknown>;
    harnessConfigOverrides?: Partial<HarnessConfig>;
    agentName?: string;
    contextFilter?: ContextFilter;
    contextSources?: string[];
    outputFormat?: 'text' | 'json';
    outputSchema?: Record<string, unknown>;
    retryPolicy?: RetryPolicy;
    timeoutMs?: number;
    condition?: StageCondition;
    iterationConfig?: IterationConfig;
    skills?: StageSkillReference[];
    approvalRequired?: boolean;
  };
  /** Inline hook handlers from this stage (phase → handler) */
  inlineHooks?: Map<string, StageHookHandler>;
}

// ── Edge Output ──

export interface EdgeOutput {
  from: string;
  to: string;
  edgeType: StageEdgeType;
  condition?: string;
}

// ── Workflow Script Output ──

/**
 * The validated output produced by WorkflowBuilder.build().
 * This is the contract between user scripts and the system.
 */
export interface WorkflowScriptOutput {
  /** Script-defined unique identifier */
  id: string;

  /** Workflow definition parameters (ready for createDefinition()) */
  definition: {
    name: string;
    description?: string;
    sessionMode: WorkflowSessionMode;
    harnessConfig?: Partial<HarnessConfig>;
    variables: VariableDefinition[];
    tags: string[];
    orchestratorConfig?: Partial<OrchestratorConfig>;
    hooks?: Array<{
      id: string;
      name: string;
      phase: WorkflowHookPhase | 'pre_clone' | 'post_clone' | 'pre_commit' | 'post_commit';
      type: HookType;
      priority: number;
      enabled: boolean;
      failurePolicy: HookFailurePolicy;
      timeoutMs: number;
      retries: number;
      config: HookConfig;
    }>;
    useWorktree?: boolean;
    skills?: SkillReference[];
    agents?: AgentReference[];
  };

  /** Stage definitions with local IDs for edge resolution */
  stages: StageOutput[];

  /** DAG edges referencing local stage IDs */
  edges: EdgeOutput[];

  /** Inline hook function references (registered in-process) */
  inlineHooks?: Map<string, WorkflowHookHandler | StageHookHandler>;
}

// ── Script Module Exports ──

/** Run profile configuration as it appears in script exports. */
export interface RunProfileConfig {
  version: 1;
  name: string;
  description?: string;
  variables: Record<string, unknown>;
  /**
   * Permission mode for the run. Accepts the script-authoring vocabulary
   * (`askOnEachTool`/`askOnce`) as well as the canonical runtime modes; the
   * server maps the former to the latter (see `mapScriptPermissionMode`).
   */
  permissionMode?: WorkflowRunPermissionMode | 'askOnEachTool' | 'askOnce';
  sessionMode?: WorkflowSessionMode;
  stageOverrides?: Array<{
    stageName?: string;
    stageIndex?: number;
    agentName?: string;
    contextFilter?: ContextFilter;
    timeoutMs?: number;
    variables?: Record<string, unknown>;
    skip?: boolean;
  }>;
}

/**
 * Complete script module export contract.
 * A .workflow.mjs file must export at least { workflow }.
 */
export interface WorkflowScriptExports {
  workflow: WorkflowScriptOutput;
  profiles?: RunProfileConfig[];
  resolveIterations?: (context: IterationResolverContext) => Promise<Record<string, unknown>[]>;
}

/** Context provided to the optional resolveIterations export */
export interface IterationResolverContext {
  variables: Record<string, unknown>;
  projectId?: string;
  workspacePath?: string;
  signal: AbortSignal;
}

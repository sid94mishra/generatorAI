// ────────────────────────────────────────────────────────────────
// Hook types. The hook DEFINITIONS (phases, configs, policies) are the v2
// spec shapes of `@generatorai/workflow-spec`, so the stored hooks, the
// `GET /hooks/phases` catalogue and the executor agree on one phase list;
// the runtime result types live here.
// ────────────────────────────────────────────────────────────────

import type {
  HookConfig as SpecHookConfig,
  HookDefinition as StageHookDefinition,
  StageHookPhase,
  WorkflowHookDefinition as SpecWorkflowHookDefinition,
  WorkflowHookPhase as SpecWorkflowHookPhase,
} from '@generatorai/workflow-spec';

/** Workflow-level hook phases — run lifecycle, git/SCM, orchestration, cross-stage. */
export type WorkflowHookPhase = SpecWorkflowHookPhase;
/** Every phase a hook can run in (stage phases and workflow phases). */
export type HookPhase = StageHookPhase | WorkflowHookPhase;
export type HookType = SpecHookConfig['type'];
export type HookFailurePolicy = StageHookDefinition['failurePolicy'];
/** A stage hook or a workflow hook, as the hook executor runs it. */
export type HookDefinition = StageHookDefinition | SpecWorkflowHookDefinition;
export type WorkflowHookDefinition = SpecWorkflowHookDefinition;
export type HookConfig = SpecHookConfig;
export type ScriptHookConfig = Extract<HookConfig, { type: 'script' }>;
export type HttpHookConfig = Extract<HookConfig, { type: 'http' }>;
export type FunctionHookConfig = Extract<HookConfig, { type: 'function' }>;

// ────────────────────────────────────────────────────────────────
// Hook Result — structured output returned by hooks
// ────────────────────────────────────────────────────────────────

/** Data returned by a hook to influence downstream execution. */
export interface HookResult {
  /** Key-value data to merge into run/stage variables */
  variables?: Record<string, unknown>;
  /** Context messages to inject as user messages before stage prompts */
  contextMessages?: Array<{
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  /** File attachments to write into the workspace */
  attachments?: Array<{
    filename: string;
    content: string;
    contentType?: string;
  }>;
  /** If true, abort the stage/run (equivalent to failurePolicy: abort) */
  abort?: boolean;
  /** Human-readable abort reason */
  abortReason?: string;
}

/** Aggregated results from all hooks in a phase */
export interface HookPhaseResult {
  /** Whether execution should continue (false = abort) */
  shouldContinue: boolean;
  /** Merged results from all hooks that ran in this phase */
  mergedResult: HookResult;
}


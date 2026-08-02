// ────────────────────────────────────────────────────────────────
// HookDefinition — Value object for hook configuration
// Pure TypeScript — zero external imports
// ────────────────────────────────────────────────────────────────

export type HookPhase =
  | 'pre_run'
  | 'post_run'
  | 'pre_clone'
  | 'post_clone'
  | 'pre_prompt'
  | 'post_prompt'
  | 'pre_commit'
  | 'post_commit'
  | 'on_error'
  | 'on_cancel'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'on_message'
  | 'on_reasoning'
  | 'on_session_start'
  | 'on_session_idle'
  | 'on_session_error'
  | 'on_client_start'
  | 'on_client_stop'
  | 'on_client_error'
  | 'on_client_restart'
  | 'on_permission'
  // ── Workflow-level phases (used in WorkflowHookDefinition) ──
  | WorkflowHookPhase;

/** Workflow-level hook phases — run lifecycle, git/SCM, orchestration, cross-stage */
export type WorkflowHookPhase =
  // Run lifecycle
  | 'on_run_start'
  | 'on_run_complete'
  | 'on_run_failed'
  | 'on_run_cancelled'
  // Git / SCM (reuse pre_clone/post_clone/pre_commit/post_commit from above)
  | 'on_pr_created'
  // Orchestration
  | 'on_preprocessing_complete'
  | 'on_postprocessing_start'
  | 'on_all_stages_scheduled'
  // Cross-stage coordination
  | 'on_stage_completed'
  | 'on_stage_failed'
  | 'on_parallel_join';

export type HookType = 'script' | 'http' | 'function';
export type HookFailurePolicy = 'abort' | 'skip' | 'continue';

export interface HookDefinition {
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
}

export type HookConfig = ScriptHookConfig | HttpHookConfig | FunctionHookConfig;

export interface ScriptHookConfig {
  type: 'script';
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface HttpHookConfig {
  type: 'http';
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: string;
}

export interface FunctionHookConfig {
  type: 'function';
  /**
   * Path (relative to the workspace) to a Node module whose default export is
   * an async function `(ctx) => Promise<void>`. When only `modulePath` is set
   * the hook executes in an isolated subprocess (sandbox-safe).
   */
  modulePath?: string;
  /**
   * ORC-03 — name of an in-process function handler registered at runtime via
   * `HookExecutor.registerFunctionHandler(name, fn)`. Use this for trusted
   * system hooks that must share the server's memory/DI container (e.g.
   * built-in metrics emitters, automation schedulers, test fixtures).
   *
   * Resolution order (highest priority first):
   *   1. `handlerName` resolves against the in-process registry.
   *   2. `modulePath` executes the module in a subprocess.
   *
   * If both are set, the registry wins; `modulePath` is ignored with a
   * warning so a misconfigured hook can be diagnosed without silently
   * dropping one path.
   */
  handlerName?: string;
  /**
   * Optional caller-supplied payload — passed to in-process handlers as
   * `ctx.args` so registered handlers don't need bespoke config plumbing.
   */
  args?: Record<string, unknown>;
}

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

// ────────────────────────────────────────────────────────────────
// Workflow-Level Hook Definition — separate from stage hooks
// ────────────────────────────────────────────────────────────────

/** Workflow-level hook definition — same shape as HookDefinition but with workflow phases */
export interface WorkflowHookDefinition {
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
}

// ────────────────────────────────────────────────────────────────
// Hooks File Config — schema for .hooks.json files
// ────────────────────────────────────────────────────────────────

/** Schema for .hooks.json files uploaded during workflow creation */
export interface HooksFileConfig {
  version: 1;
  /** Workflow-level lifecycle hooks */
  workflow: WorkflowHookDefinition[];
  /** Stage-level hooks. Key '*' applies to all stages; named keys apply by stage name. */
  stages: Record<string, HookDefinition[]>;
}

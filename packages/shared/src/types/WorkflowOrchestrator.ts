// ────────────────────────────────────────────────────────────────
// WorkflowOrchestrator — Types for workflow orchestration layer
// Handles preprocessing, codebase/worktree integration, result
// validation, system/custom workflows, and parameterized execution.
// ────────────────────────────────────────────────────────────────

import type { ScmFlowResult } from './SourceControl.js';
import type { HarnessConfig } from './Workflow.js';
import type { StageRunOverride } from './RunProfile.js';

/** Preprocessing step types */
export type PreprocessingStepType =
  | 'clone_repo'
  | 'run_script'
  | 'validate_input'
  | 'set_variable'
  | 'conditional';

/** A single preprocessing step to execute before workflow stages */
export interface PreprocessingStep {
  type: PreprocessingStepType;
  name: string;
  /** Configuration specific to the step type */
  config: PreprocessingStepConfig;
  /** Whether to abort the workflow if this step fails */
  failOnError: boolean;
  /** Order of execution (lower = earlier) */
  order: number;
}

/** Union of preprocessing step configs */
export type PreprocessingStepConfig =
  | CloneRepoStepConfig
  | RunScriptStepConfig
  | ValidateInputStepConfig
  | SetVariableStepConfig
  | ConditionalStepConfig;

export interface CloneRepoStepConfig {
  type: 'clone_repo';
  repoAlias: string;
}

export interface RunScriptStepConfig {
  type: 'run_script';
  script: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface ValidateInputStepConfig {
  type: 'validate_input';
  variableName: string;
  rules: ValidationRule[];
}

export interface SetVariableStepConfig {
  type: 'set_variable';
  variableName: string;
  /** Static value or expression referencing other variables */
  value: string;
}

export interface ConditionalStepConfig {
  type: 'conditional';
  condition: string;
  thenSteps: PreprocessingStep[];
  elseSteps?: PreprocessingStep[];
}

/** Validation rules for inputs/results */
export interface ValidationRule {
  type: 'required' | 'regex' | 'min_length' | 'max_length' | 'custom';
  value?: string | number;
  message: string;
}

/** Result validation config for a stage */
export interface StageResultValidation {
  stageIndex: number;
  rules: ResultValidationRule[];
}

/** A rule for validating stage output */
export interface ResultValidationRule {
  type: 'contains' | 'not_contains' | 'min_length' | 'max_length' | 'regex' | 'custom_script' | 'json_schema' | 'llm_validation';
  value?: string | number | Record<string, unknown>;
  message: string;
}

/** Workflow category for distinguishing system vs custom */
export type WorkflowCategory = 'system' | 'custom' | 'derived';

// ── Post-Processing Step Types ──

/** Post-processing step types that run after all DAG stages complete */
export type PostProcessingStepType = 'commit_and_push' | 'create_pr' | 'run_script';

/** A single post-processing step to execute after workflow stages complete */
export interface PostProcessingStep {
  type: PostProcessingStepType;
  name: string;
  config: PostProcessingStepConfig;
  /** Whether to mark the run as failed if this step fails */
  failOnError: boolean;
  /** Order of execution (lower = earlier) */
  order: number;
  /** Whether this step is enabled */
  enabled: boolean;
}

/** Union of post-processing step configs */
export type PostProcessingStepConfig =
  | CommitAndPushStepConfig
  | CreatePRStepConfig
  | PostRunScriptStepConfig;

export interface CommitAndPushStepConfig {
  type: 'commit_and_push';
  /** Which repo alias to commit (if empty, commits all cloned repos) */
  repoAlias?: string;
  /** Commit message — supports {{variable}} interpolation */
  commitMessage: string;
  /**
   * Push the work branch after committing. Defaults to true (the step is
   * named commit_AND_PUSH); set false for `autoCommit` without `autoPush`,
   * which commits locally and leaves the branch for the user.
   */
  push?: boolean;
  /**
   * Let the flow generate the commit message from the diff instead of using
   * `commitMessage` verbatim. The auto-step built from `autoCommit` sets this.
   */
  generateMessage?: boolean;
  /** Base branch to sync before pushing; defaults to the repo's default. */
  baseBranch?: string;
}

export interface CreatePRStepConfig {
  type: 'create_pr';
  /** Which repo alias to create PR for */
  repoAlias?: string;
  /** PR title — supports {{variable}} interpolation */
  title: string;
  /** PR body — supports {{variable}} interpolation */
  body: string;
  /** Base branch to merge into (defaults to original branch) */
  baseBranch?: string;
  /** Let the flow generate the title/body from the branch instead of using
   *  `title`/`body` verbatim. The auto-step built from `autoCreatePR` sets it. */
  generateText?: boolean;
  draft?: boolean;
}

export interface PostRunScriptStepConfig {
  type: 'run_script';
  script: string;
  cwd?: string;
  timeoutMs?: number;
}

/** Extended workflow definition fields for the orchestrator */
export interface OrchestratorConfig {
  /** Category of workflow */
  category: WorkflowCategory;
  /** If derived from a system workflow, reference the parent template */
  parentTemplateId?: string;
  /** Codebase aliases from the linked project to use */
  codebaseAliases?: string[];
  /** Preprocessing steps to run before the DAG */
  preprocessingSteps: PreprocessingStep[];
  /** Post-processing steps to run after all stages complete */
  postProcessingSteps: PostProcessingStep[];
  /** Result validation after each stage */
  resultValidations: StageResultValidation[];
  /** Whether this workflow requires at least one codebase */
  requiresCodebase: boolean;
  /** Whether to auto-commit changes after workflow completes */
  autoCommit: boolean;
  /**
   * Whether to push the run's work branch after committing. Implied by
   * `autoCreatePR` (a PR needs a pushed head), so it only matters on its own
   * for "commit + push, but do not open a PR".
   */
  autoPush?: boolean;
  /** Whether to auto-create PR after workflow completes */
  autoCreatePR: boolean;
}

/** Parameters for starting an orchestrated workflow run */
export interface OrchestratedRunParams {
  workflowDefinitionId: string;
  variables?: Record<string, unknown>;
  /** Project ID — repos are resolved from project codebases via worktrees */
  projectId?: string;
  /** Codebase aliases to use from the project */
  selectedCodebases?: string[];
  /** Per-stage runtime overrides (skip, variables, agentName, timeout) */
  stageOverrides?: StageRunOverride[];
}

/** Status of the orchestrator execution context */
export interface OrchestratorContext {
  workflowRunId: string;
  workflowDefinitionId: string;
  /** Map of repo alias → local clone path */
  clonedRepositories: Record<string, string>;
  /** Map of repo alias → feature branch name */
  featureBranches: Record<string, string>;
  /**
   * Map of repo alias → the codebase's default branch. Post-processing opens
   * pull requests against it, and syncs it into the work branch first.
   */
  baseBranches?: Record<string, string>;
  /** Resolved variables (after preprocessing) */
  resolvedVariables: Record<string, unknown>;
  /** Preprocessing results */
  preprocessingResults: PreprocessingResult[];
  /** Post-processing results */
  postProcessingResults: PreprocessingResult[];
}

export interface PreprocessingResult {
  stepName: string;
  success: boolean;
  error?: string;
  output?: string;
  durationMs: number;
  /**
   * Source-control flow results, one per repo the step touched, when the step
   * ran through `SourceControlFlowService`. Carries the conflict report /
   * blocking reason the run page renders; `error` stays the one-line summary.
   */
  scm?: ScmFlowResult[];
}

export interface StageValidationResult {
  stageIndex: number;
  stageName: string;
  passed: boolean;
  failures: string[];
}

/** Workspace/artifact info for a workflow run */
export interface RunWorkspaceInfo {
  runId: string;
  workspaceDir: string;
  artifactsDir: string;
  uploadsDir: string;
  workspaceFiles: string[];
  artifactFiles: string[];
  uploadFiles: string[];
  worktrees?: Array<{
    alias: string;
    worktreePath: string;
    files: string[];
    /** How this codebase came into being for this run.
     *  - 'linked'    → an existing codebase intentionally attached to the workflow
     *  - 'generated' → a git repo the agent created inside the run workspace */
    kind?: 'linked' | 'generated';
  }>;
}

/** Response from uploading files to a run */
export interface RunUploadResult {
  success: boolean;
  runId: string;
  category: 'skills' | 'agents' | 'prompts';
  files: Array<{ path: string; name: string }>;
  directory: string;
}


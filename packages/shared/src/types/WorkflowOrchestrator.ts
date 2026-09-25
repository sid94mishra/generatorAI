// ────────────────────────────────────────────────────────────────
// WorkflowOrchestrator — runtime types of the orchestration layer
// (preprocessing results, the run context, workspaces, uploads). The
// definition-side shapes (lifecycle steps, rules) are the v2 spec in
// `@generatorai/workflow-spec`.
// ────────────────────────────────────────────────────────────────

import type { ScmFlowResult } from './SourceControl.js';
import type { StageRunOverride } from './RunProfile.js';

/** Parameters for starting an orchestrated workflow run */
export interface OrchestratedRunParams {
  workflowDefinitionId: string;
  variables?: Record<string, unknown>;
  /** Project ID — repos are resolved from project codebases via worktrees */
  projectId?: string;
  /** Codebase aliases to use from the project */
  selectedCodebases?: string[];
  /** Per-stage runtime overrides, by stage key */
  stageOverrides?: StageRunOverride[];
  /** Run the definition's working graph as a test version (drafts can only test-run). */
  testRun?: boolean;
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
  stageKey: string;
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


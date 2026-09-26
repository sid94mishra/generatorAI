// ────────────────────────────────────────────────────────────────
// Run lifecycle — runtime shapes of a run's prepare and finalize phases
// (P04 WP-4.1): the engine-owned system values of a run (`system_vars`,
// never user variables; W-06), the lifecycle step results and the run
// workspace listing. The definition-side shapes (lifecycle steps) are the
// v2 spec in `@generatorai/workflow-spec`.
// ────────────────────────────────────────────────────────────────

import type { ScmFlowResult } from './SourceControl.js';

/** What one pre- or post-processing step did. */
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

/** A codebase the run mounted or cloned: `run.codebases.<alias>`. */
export interface RunCodebase {
  path: string;
  branch: string | null;
  /** The ref the checkout was cut from; a pull request targets it. */
  baseRef: string | null;
  /** The `workspace_mounts` row (absent for a `clone_repo` checkout). */
  mountId?: string;
}

/** A journalled lifecycle phase (`lifecycle/<phase>`): a crash resumes after the last one done. */
export interface RunPhaseRecord {
  status: 'done' | 'failed';
  at: number;
  detail?: string;
}

/**
 * Engine-owned values of a run (the `system_vars` column). The lifecycle
 * writes them; the executor reads them. Callers never supply them.
 */
export interface RunSystemVars {
  /** The directory stages start in: the primary mount. */
  workingDirectory?: string;
  artifactsDirectory?: string;
  /** Mounted and cloned codebases, by alias. */
  codebases?: Record<string, RunCodebase>;
  /** Skill directories from the run's uploads and project configs. */
  skillDirectories?: string[];
  /** Sub-agents from the run's uploaded agent files. */
  customAgents?: Array<{ name: string; description: string; instructions: string }>;
  promptDirectories?: string[];
  /** The run's sandbox, when the deployment runs stages in one. */
  sandbox?: { name: string; cliUrl?: string; docker: boolean };
  /**
   * The trigger's ceiling (an automation's declared mode, PD-18, or the
   * invoking chat's / stage's own mode): the definition layers never widen it.
   */
  triggerPermissionMode?: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan';
  /** Upload ids staged before the run, consumed by the `uploads` phase. */
  uploads?: Array<{ uploadId: string; category: 'skills' | 'agents' | 'prompts' }>;
  /** The journal of lifecycle phases, by phase (`prepare/<phase>`, `finalize/<phase>`). */
  lifecycle?: Record<string, RunPhaseRecord>;
  preprocessing?: PreprocessingResult[];
  postProcessing?: PreprocessingResult[];
  /**
   * A sub-workflow child with `workspace: inherit` (P05 §4.2): it works in
   * its parent run's workspace and mounts. Its own mount preparation,
   * post-processing and workspace release are skipped: the parent commits.
   */
  inheritedWorkspace?: { fromRunId: string; workspaceId: string };
}

/** Workspace/artifact info for a workflow run (`GET /workflow-runs/:id/workspace`). */
export interface RunWorkspaceInfo {
  runId: string;
  workspaceDir: string;
  artifactsDir: string;
  uploadsDir: string;
  workspaceFiles: string[];
  artifactFiles: string[];
  uploadFiles: string[];
  /** The run's mounts (codebase worktrees, in-place checkouts, the generated mount). */
  worktrees?: Array<{
    alias: string;
    worktreePath: string;
    files: string[];
    /** 'linked': a project codebase mounted for the run; 'generated': the run's own directory. */
    kind?: 'linked' | 'generated';
  }>;
}

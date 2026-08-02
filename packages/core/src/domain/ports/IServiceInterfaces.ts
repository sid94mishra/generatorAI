// ────────────────────────────────────────────────────────────────
// IServiceInterfaces — Port interfaces for v2 domain services
// ────────────────────────────────────────────────────────────────

import type { Session, SessionStatus, WorkflowSessionMode } from '@generatorai/shared';

/**
 * ISessionAllocator — Manages Copilot SDK session lifecycle
 * for workflow run execution across three session modes.
 */
export interface ISessionAllocator {
  /**
   * Allocate a session for a stage run.
   * - `single` mode: reuse or create one session for the entire run
   * - `per-stage` mode: create a new session for each stage
   * - `auto` mode: reuse sessions in chains, new sessions for parallel branches
   */
  allocateSession(
    workflowRunId: string,
    stageRunId: string,
    sessionMode: WorkflowSessionMode,
    config?: {
      model?: string;
      repoUrl?: string;
      repoBranch?: string;
      workspacePath?: string;
    },
  ): Promise<Session>;

  /**
   * Release a session after a stage completes.
   * For `per-stage` mode: destroys the session immediately.
   * For `single`/`auto`: releases only when last stage using it completes.
   */
  releaseSession(stageRunId: string): Promise<void>;

  /**
   * Release all sessions for a workflow run.
   * Called during cancel or completion for final cleanup.
   */
  releaseAll(workflowRunId: string): Promise<void>;
}

/**
 * IDAGScheduler — Orchestrates DAG-based stage execution ordering
 */
export interface IDAGScheduler {
  /**
   * Build and cache the DAG for a workflow definition.
   */
  buildDAGForDefinition(workflowDefinitionId: string): Promise<unknown>;

  /**
   * Get root stages (no dependencies) for a workflow run.
   * Returns stage definition IDs.
   */
  getRootStages(workflowRunId: string, workflowDefinitionId: string): Promise<string[]>;

  /**
   * Get stages that are ready to execute (all dependencies met).
   * Returns stage definition IDs.
   */
  getReadyStages(workflowRunId: string, workflowDefinitionId: string): Promise<string[]>;

  /**
   * Schedule the next ready stages for execution after a stage completes.
   * Returns stage definition IDs that should be enqueued.
   */
  scheduleNext(workflowRunId: string, workflowDefinitionId: string, completedStageDefId: string): Promise<string[]>;

  /**
   * Handle a stage completion event.
   * Evaluates edge conditions and returns dependent stage definition IDs to schedule.
   */
  onStageCompleted(workflowRunId: string, workflowDefinitionId: string, completedStageDefId: string): Promise<string[]>;

  /**
   * Handle a stage failure event.
   * Evaluates failure edges and returns stage definition IDs to schedule.
   */
  onStageFailed(workflowRunId: string, workflowDefinitionId: string, failedStageDefId: string): Promise<string[]>;

  /**
   * Check if the DAG execution is complete (all stages terminal).
   */
  isDAGComplete(workflowRunId: string, workflowDefinitionId: string): Promise<boolean>;

  /**
   * Get stages that should be skipped (condition not met, all predecessors terminal).
   */
  getSkippableStages(workflowRunId: string, workflowDefinitionId: string): Promise<string[]>;

  /**
   * Clear cached DAG for a definition.
   */
  clearCache(workflowDefinitionId: string): void;
}

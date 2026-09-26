// ────────────────────────────────────────────────────────────────
// LoopEffects — the two effects of the generic loop (P05 §2.3, §2.5).
//
//   capture_iteration  the tree hash of every mount (`git add -A` into a
//                      private index + `write-tree`; null where it cannot be
//                      computed) at the loop's start and each iteration's
//                      end, plus — with per-iteration checkpoints — a
//                      checkpoint of every mount under the turn id
//                      `loop:<stageRunId>:<k>` (never skipped as unchanged);
//   restore_iteration  every mount back to an iteration's checkpoint, all
//                      or nothing (a partial restore is rolled back).
//
// Both are idempotent: a recovery that re-dispatches one after a crash in
// `settling` or `restoring` gets the same answer. They never throw: a
// failure is part of the answer the actor decides on.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import type { WorkspaceCheckpointService } from '../WorkspaceCheckpointService.js';
import type { WorkspaceManager } from '../WorkspaceManager.js';
import { runWorkspace } from '../session/workspaceExposure.js';

export interface LoopEffectsDeps {
  runRepo: IWorkflowRunRepository;
  workspaceManager: WorkspaceManager;
  checkpoints?: WorkspaceCheckpointService | undefined;
  logger?: ILogger | undefined;
}

/** The checkpoint turn id of a loop iteration. */
export function iterationTurnId(stageRunId: string, k: number): string {
  return `loop:${stageRunId}:${k}`;
}

export class LoopEffects {
  constructor(private readonly deps: LoopEffectsDeps) {}

  setCheckpoints(checkpoints: WorkspaceCheckpointService): void {
    this.deps.checkpoints = checkpoints;
  }

  async capture(
    runId: string,
    stageRunId: string,
    k: number,
    checkpoint: boolean,
  ): Promise<{ treeHashes: Record<string, string | null> | null; checkpointTurnId: string | null }> {
    const svc = this.deps.checkpoints;
    if (!svc) return { treeHashes: null, checkpointTurnId: null };
    try {
      const run = await this.deps.runRepo.getById(runId);
      const workspace = await runWorkspace(this.deps.workspaceManager, run);
      const treeHashes = await svc.treeHashes(workspace.id);
      let checkpointTurnId: string | null = null;
      if (checkpoint) {
        const turnId = iterationTurnId(stageRunId, k);
        const records = await svc.capture({
          workspaceId: workspace.id,
          kind: 'stage',
          label: `loop iteration ${k + 1}`,
          workflowRunId: runId,
          stageRunId,
          phase: 'after',
          turnId,
          skipIfUnchanged: false,
        });
        if (records.length > 0) checkpointTurnId = turnId;
      }
      return { treeHashes, checkpointTurnId };
    } catch (err) {
      this.deps.logger?.warn(`[LoopEffects] capturing iteration ${k} of ${stageRunId} failed: ${String(err)}`);
      return { treeHashes: null, checkpointTurnId: null };
    }
  }

  async restore(runId: string, _stageRunId: string, _k: number, checkpointTurnId: string): Promise<{ ok: boolean; error?: string }> {
    const svc = this.deps.checkpoints;
    if (!svc) return { ok: false, error: 'Checkpoints are not available on this server' };
    try {
      const run = await this.deps.runRepo.getById(runId);
      const workspace = await runWorkspace(this.deps.workspaceManager, run);
      return await svc.restoreTurnAllOrNothing(workspace.id, checkpointTurnId, { workflowRunId: runId }, 'after');
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

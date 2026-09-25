// ────────────────────────────────────────────────────────────────
// HitlService — human-in-the-loop on stage INSTANCES (P03 WP-3.7).
//
// A stage's gates (completion review, tool permission, question, plan
// review) park the engine's executor frame: the instance is
// `awaiting_input` with the request in `interrupt_data` (StageGatePort,
// StageExecutor). This service is the operator side:
//   - `listPending` reads the parked instances of a run;
//   - `resolve` posts the `approve` run command, which the actor delivers
//     to the live frame, or turns into a resume attempt that carries the
//     verdict when the frame did not survive a restart;
//   - `cancel` posts `cancel`, which aborts the frame and so releases its
//     waiter (B-4) after the desired state is written.
// There is no in-process waiter map and nothing to rehydrate: the
// instance row and the engine's journal are the state.
// ────────────────────────────────────────────────────────────────

import type { StageRun, StageReviewOutcome } from '@generatorai/shared';
import type { RunCommand } from '@generatorai/workflow-spec';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { CommandResult } from './engine/RunSupervisor.js';

/** The engine's command entry point (`RunSupervisor.command`). */
export interface RunCommandPort {
  command(runId: string, command: RunCommand): Promise<CommandResult>;
}

export interface StageVerdict {
  outcome: StageReviewOutcome;
  /** Reviewer feedback: sent to the stage on `changes_requested`, the rejection reason on `rejected`. */
  feedback?: string;
  /** Structured input: a question's `{answers}`, a plan's `{action, feedback}`. */
  data?: Record<string, unknown>;
  expectedVersion?: number;
}

export class HitlService {
  constructor(
    private readonly stageRunRepo: IStageRunRepository,
    private readonly engine: RunCommandPort,
  ) {}

  /** Instances of the run parked on a human. */
  listPending(workflowRunId: string): Promise<StageRun[]> {
    return this.stageRunRepo.getByStatus(workflowRunId, ['awaiting_input']);
  }

  /** Answer a parked instance (the `approve` command). */
  resolve(workflowRunId: string, instanceId: string, verdict: StageVerdict): Promise<CommandResult> {
    return this.engine.command(workflowRunId, {
      command: 'approve',
      instanceId,
      outcome: verdict.outcome,
      ...(verdict.feedback !== undefined ? { feedback: verdict.feedback } : {}),
      ...(verdict.data !== undefined ? { data: verdict.data } : {}),
      ...(verdict.expectedVersion !== undefined ? { expectedVersion: verdict.expectedVersion } : {}),
    });
  }

  /** Cancel a parked instance: its waiter is released by the engine's abort (B-4). */
  cancel(workflowRunId: string, instanceId: string): Promise<CommandResult> {
    return this.engine.command(workflowRunId, { command: 'cancel', instanceId });
  }
}

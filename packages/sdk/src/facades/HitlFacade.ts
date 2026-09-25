// ────────────────────────────────────────────────────────────────
// HitlFacade — ai.hitl.*
//
// The operator side of a stage's human gates. A gate (completion review,
// tool permission, question, plan review) parks its stage instance in
// `awaiting_input`; these methods list and answer the parked instances.
// Answers and cancels are run commands (`approve`, `cancel`).
// ────────────────────────────────────────────────────────────────

import { RunCommandRefusedError, type CoreServices, type HitlService, type StageVerdict } from '@generatorai/core';
import type { StageRun } from '@generatorai/shared';

export type { StageVerdict };

export class HitlFacade {
  private hitlService: HitlService;

  constructor(services: CoreServices) {
    this.hitlService = services.hitlService;
  }

  /** The run's instances waiting on a human (their `interruptData` is the request). */
  pending(workflowRunId: string): Promise<StageRun[]> {
    return this.hitlService.listPending(workflowRunId);
  }

  /** Answer a parked instance. Throws when the engine refuses (not awaiting input, stale version, …). */
  async resolve(workflowRunId: string, instanceId: string, verdict: StageVerdict): Promise<void> {
    const r = await this.hitlService.resolve(workflowRunId, instanceId, verdict);
    if (!r.ok) throw new RunCommandRefusedError(r);
  }

  /** Cancel a parked instance (its waiter is released by the engine). */
  async cancel(workflowRunId: string, instanceId: string): Promise<void> {
    const r = await this.hitlService.cancel(workflowRunId, instanceId);
    if (!r.ok) throw new RunCommandRefusedError(r);
  }
}

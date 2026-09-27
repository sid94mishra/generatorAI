// ────────────────────────────────────────────────────────────────
// HitlFacade — ai.hitl.*
//
// The operator side of the decisions a run waits on: a stage's human gates
// (completion review, tool permission, question, plan review), parked
// loops and approval/event waits — the run's sub-workflow children's
// included. Everything goes through `WorkflowApprovalService`, the one way
// the commands route, the run page and the workflow tools answer them:
// an approval wait's form is validated, and an answer reaches the child
// run that owns the instance.
// ────────────────────────────────────────────────────────────────

import { RunCommandRefusedError, type ApprovalVerdictInput, type CoreServices, type PendingDecision, type WorkflowApprovalService } from '@generatorai/core';

export type { ApprovalVerdictInput, PendingDecision };

export class HitlFacade {
  private approvals: WorkflowApprovalService;

  constructor(services: CoreServices) {
    this.approvals = services.workflowApprovalService;
  }

  /** The decisions the run waits on (its sub-workflow children's included); `interruptData` is the request. */
  pending(workflowRunId: string): Promise<PendingDecision[]> {
    return this.approvals.listPending(workflowRunId);
  }

  /** Answer a pending decision. Throws when the engine refuses (not awaiting input, stale version, …). */
  async resolve(workflowRunId: string, instanceId: string, verdict: ApprovalVerdictInput): Promise<void> {
    const r = await this.approvals.respond(workflowRunId, instanceId, verdict);
    if (!r.ok) throw new RunCommandRefusedError(r);
  }

  /** Cancel a pending instance (its waiter is released by the engine). */
  async cancel(workflowRunId: string, instanceId: string): Promise<void> {
    const r = await this.approvals.cancel(workflowRunId, instanceId);
    if (!r.ok) throw new RunCommandRefusedError(r);
  }
}

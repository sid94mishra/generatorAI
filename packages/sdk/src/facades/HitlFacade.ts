// ────────────────────────────────────────────────────────────────
// HitlFacade — ai.hitl.*
//
// Human-in-the-loop operations: interrupt stages to request human
// input, resume with approval/rejection.
// ────────────────────────────────────────────────────────────────

import type { CoreServices, HitlService } from '@generatorai/core';

export interface InterruptOptions {
  /** Prompt to display to the human reviewer */
  prompt?: string;
}

export interface InterruptResolution {
  approved: boolean;
  value?: unknown;
  reason?: string;
}

export class HitlFacade {
  private hitlService: HitlService;

  constructor(private services: CoreServices) {
    this.hitlService = services.hitlService;
  }

  /**
   * Interrupt a running stage and wait for human input.
   *
   * The stage enters `awaiting_input` status. Call `resume()` to continue.
   * Returns a promise that resolves when the human responds.
   */
  async interrupt(
    stageRunId: string,
    workflowRunId: string,
    data: unknown,
    options?: InterruptOptions,
  ): Promise<InterruptResolution> {
    return this.hitlService.interrupt(stageRunId, workflowRunId, data, options);
  }

  /**
   * Resume a stage that is awaiting human input.
   */
  async resume(
    stageRunId: string,
    workflowRunId: string,
    resolution: InterruptResolution,
  ): Promise<{ ok: boolean; reason?: string }> {
    return this.hitlService.resume(stageRunId, workflowRunId, resolution);
  }

  /**
   * Cancel a pending interrupt (rejects the waiting promise).
   */
  cancelWaiter(stageRunId: string, reason: string): void {
    this.hitlService.cancelWaiter(stageRunId, reason);
  }
}

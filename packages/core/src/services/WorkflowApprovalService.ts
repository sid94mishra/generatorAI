// ────────────────────────────────────────────────────────────────
// WorkflowApprovalService — the decisions a run is waiting on, and the one
// way to answer them (P05 WP-5B.2; extracted here from P06 WP-6.2,
// cross-file #14).
//
// A decision is an instance a person (or an external system) must act on:
//   - an `awaiting_input` instance: a completion review, an in-turn gate
//     (tool permission, question, plan review), a parked loop (its
//     decision card: grant, raise budget, continue, accept, fail);
//   - a `waiting` approval wait (approve or reject, with its form) and a
//     `waiting` event wait (deliver its event; the callback URL).
// Sub-workflow children are MIRRORED: a parent lists every pending
// decision of its running children (recursively, the run tree is at most 3
// deep), each with the chain of sub-workflow instances it came through, and
// an answer sent to the parent reaches the child that owns the instance.
// The commands route, the run page, the digest and (P06) the chat tools all
// go through here.
// ────────────────────────────────────────────────────────────────

import type { StageRun } from '@generatorai/shared';
import { NotFoundError, ValidationError } from '@generatorai/shared';
import { MAX_INVOCATION_DEPTH, type RunCommand } from '@generatorai/workflow-spec';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import type { WaitInterrupt } from '../domain/scheduler/waits.js';
import { validateAgainstSchema } from './engine/OutputExtractor.js';
import type { CommandResult } from './engine/RunSupervisor.js';
import type { WorkflowCallbacks } from './engine/WorkflowCallbacks.js';

export interface PendingDecision {
  /** The run that owns the instance (a child run for a mirrored card). */
  runId: string;
  instanceId: string;
  stageKey: string;
  instancePath: string;
  name: string;
  /** `stage_completion_review`, `tool_permission`, `question`, `plan_review`, `loop_decision`, or `wait`. */
  kind: string;
  /** For a wait: approval or event. */
  waitType?: 'approval' | 'event';
  interruptData: unknown;
  /** The instance's CAS version (commands may send it as `expectedVersion`). */
  version: number;
  /** An event wait's callback. */
  callback?: { url: string; token: string };
  /** Mirrored from a sub-workflow child: the sub-workflow instances it came through, outermost first. */
  via: Array<{ runId: string; instanceId: string; stageKey: string; name: string }>;
}

export interface ApprovalVerdictInput {
  outcome: 'approved' | 'rejected' | 'changes_requested';
  feedback?: string;
  data?: Record<string, unknown>;
  expectedVersion?: number;
}

export interface WorkflowApprovalServiceDeps {
  runRepo: IWorkflowRunRepository;
  stageRuns: IStageRunRepository;
  /** A run command (the engine), with who sent it. */
  command: (runId: string, command: RunCommand, opts: { actor?: string }) => Promise<CommandResult>;
  callbacks?: WorkflowCallbacks | undefined;
}

function waitOf(s: Pick<StageRun, 'kind' | 'status' | 'interruptData'>): WaitInterrupt | null {
  if (s.kind !== 'wait' || s.status !== 'waiting') return null;
  const d = s.interruptData as WaitInterrupt | null;
  return d && typeof d === 'object' && d.kind === 'wait' ? d : null;
}

export class WorkflowApprovalService {
  constructor(private readonly deps: WorkflowApprovalServiceDeps) {}

  /** Late wiring: the callback key is loaded after the core services. */
  setCallbacks(callbacks: WorkflowCallbacks): void {
    this.deps.callbacks = callbacks;
  }

  /** An event wait's callback, when the instance is a waiting event wait. */
  callbackFor(s: Pick<StageRun, 'id' | 'workflowRunId' | 'kind' | 'status' | 'interruptData'>): { url: string; token: string } | undefined {
    const w = waitOf(s);
    if (!w || w.type !== 'event' || !this.deps.callbacks) return undefined;
    return this.deps.callbacks.forWait(s.workflowRunId, s.id, w.eventKey) ?? undefined;
  }

  /** Every decision the run waits on, its sub-workflow children's included. */
  async listPending(runId: string): Promise<PendingDecision[]> {
    const out: PendingDecision[] = [];
    const visit = async (id: string, via: PendingDecision['via'], depth: number): Promise<void> => {
      const stages = await this.deps.stageRuns.getByRunId(id);
      for (const s of [...stages].sort((a, b) => (a.instancePath < b.instancePath ? -1 : 1))) {
        const w = waitOf(s);
        if (s.status === 'awaiting_input' || (w && w.type !== 'timer')) {
          const kind = w ? 'wait' : String((s.interruptData as { kind?: unknown } | null)?.kind ?? 'stage_completion_review');
          const callback = this.callbackFor(s);
          out.push({
            runId: id,
            instanceId: s.id,
            stageKey: s.stageKey,
            instancePath: s.instancePath,
            name: s.name,
            kind,
            ...(w ? { waitType: w.type as 'approval' | 'event' } : {}),
            interruptData: s.interruptData ?? null,
            version: s.version,
            ...(callback ? { callback } : {}),
            via,
          });
        }
        const child = s.subworkflowState?.childRunId;
        if (child && s.status === 'running' && depth < MAX_INVOCATION_DEPTH) {
          await visit(child, [...via, { runId: id, instanceId: s.id, stageKey: s.stageKey, name: s.name }], depth + 1);
        }
      }
    };
    await visit(runId, [], 0);
    return out;
  }

  /**
   * Answer a decision: an approval of a completion review or of an approval
   * wait (its form validated here), sent to the run that owns the instance —
   * `runId` itself or one of its sub-workflow descendants.
   */
  async respond(runId: string, instanceId: string, verdict: ApprovalVerdictInput, opts: { actor?: string } = {}): Promise<CommandResult> {
    const inst = await this.deps.stageRuns.getById(instanceId).catch(() => null);
    if (!inst) throw new NotFoundError('Stage instance', instanceId);
    const owner = await this.ownerWithin(runId, inst.workflowRunId);
    if (!owner) throw new NotFoundError('Stage instance', `${instanceId} of run ${runId}`);
    const w = waitOf(inst);
    if (w?.type === 'approval' && w.form && verdict.outcome === 'approved') {
      const r = validateAgainstSchema(w.form, verdict.data ?? {});
      if (!r.ok) throw new ValidationError(`The approval form is not valid: ${r.errors.slice(0, 5).join('; ')}`);
    }
    return this.deps.command(
      owner,
      {
        command: 'approve',
        instanceId,
        outcome: verdict.outcome,
        ...(verdict.feedback !== undefined ? { feedback: verdict.feedback } : {}),
        ...(verdict.data !== undefined ? { data: verdict.data } : {}),
        ...(verdict.expectedVersion !== undefined ? { expectedVersion: verdict.expectedVersion } : {}),
      },
      opts,
    );
  }

  /** The owning run when it is `runId` or a sub-workflow descendant of it. */
  private async ownerWithin(runId: string, ownerRunId: string): Promise<string | null> {
    let cur: string | undefined = ownerRunId;
    for (let i = 0; cur && i <= MAX_INVOCATION_DEPTH; i++) {
      if (cur === runId) return ownerRunId;
      const run: { parentRunId?: string | undefined } | null = await this.deps.runRepo.getById(cur).catch(() => null);
      cur = run?.parentRunId;
    }
    return null;
  }
}

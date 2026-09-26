// ────────────────────────────────────────────────────────────────
// StageConversationService — a stage is a compact chat (P03b WP-3b.1,
// G2 §4.2, PD-3, PD-4, PD-9).
//
// What an operator can do with one agent instance of a run, from the run
// page, a phone, the TUI or the CLI:
//
//   send      — what a message does depends on the instance's state:
//                 mid-turn (running)          → 409 STAGE_BUSY (PD-3, chat parity)
//                 awaiting a gate             → 409 INTERACTION_PENDING
//                 between turns               → queued: the next `operator` turn
//                 completed                   → AMEND (PD-4): the conversation
//                   resumes on its session key, the operator turn runs, the
//                   output contract is checked again, and the new output
//                   replaces the old one (`amended_at`, `stage_run.amended`).
//                   Successors are NOT re-run; the UI offers a fork from here.
//                 paused                      → the `retry {mode: resume,
//                   promptOverride}` command: the new attempt sends it as its
//                   next turn
//                 not started / failed / skipped / cancelled → 409
//   stop      — end the turn in flight without failing the stage;
//   answer    — resolve an in-turn gate (tool permission, question, plan
//               review) through the `approve` command, checked against the
//               interaction the stage is actually waiting on.
//
// The completion review stays the `approve` run command (PD-9: the one
// feedback path besides this API; there is no approve-with-follow-up).
// ────────────────────────────────────────────────────────────────

import type { AgentMode, ILogger } from '@generatorai/shared';
import type { RunCommand } from '@generatorai/workflow-spec';
import type { IStageRunRepository } from '../../domain/ports/IStageRunRepository.js';
import type { OperatorTurn } from '../../domain/scheduler/types.js';
import type { CommandResult, RunSupervisor } from './RunSupervisor.js';
import { StageConversationError } from './StageConversationError.js';

/** An operator message to a stage. */
export interface StageMessage {
  prompt: string;
  /** Files already uploaded to the stage (artifact ids, `stage_run_id` = the instance). */
  attachmentIds?: string[];
  /** The agent mode of this turn; omitted uses the stage's default. */
  agentMode?: AgentMode;
}

/** How a message was taken: queued for the next turn, amending a completed stage, or retrying a paused one. */
export type StageSendOutcome = 'queued' | 'amending' | 'retrying';

/** A gate answer, in the chat's shapes (ResolveToolPermissionSchema, AnswerQuestionSchema, PlanDecisionSchema). */
export type StageGateAnswer =
  | { kind: 'permission'; behavior: 'allow' | 'deny'; message?: string }
  | { kind: 'answer'; answers: Record<string, string[]>; freeformResponse?: string }
  | { kind: 'plan'; approved: boolean; action?: 'exit_only' | 'implement_interactive' | 'implement_autopilot'; feedback?: string };

/** The `interrupt_data.kind` each answer resolves. */
const GATE_KIND: Record<StageGateAnswer['kind'], string> = {
  permission: 'tool_permission',
  answer: 'question',
  plan: 'plan_review',
};

export interface StageConversationServiceDeps {
  engine: RunSupervisor;
  stageRuns: IStageRunRepository;
  logger?: ILogger | undefined;
}

export class StageConversationService {
  /** Amendments in flight (their outcome is an event): what `idle()` waits for. */
  private readonly inflight = new Set<Promise<void>>();

  constructor(private readonly deps: StageConversationServiceDeps) {}

  private get engine(): RunSupervisor {
    return this.deps.engine;
  }

  /** The instance row, checked to belong to the run and to be an agent stage. */
  private instance(runId: string, instanceId: string) {
    if (!this.engine.running) {
      throw new StageConversationError('ENGINE_UNAVAILABLE', 'The workflow engine is not running in this process');
    }
    const row = this.engine.stores.stages.getInstance(instanceId);
    if (!row || row.workflowRunId !== runId) throw new StageConversationError('NOT_FOUND', `No stage instance ${instanceId} in run ${runId}`);
    if (row.kind !== 'agent') throw new StageConversationError('STAGE_NOT_CONVERSABLE', `A ${row.kind} stage has no conversation`);
    return row;
  }

  /**
   * The session an attachment is stored under (artifacts belong to a
   * session). A stage that never started has none.
   */
  attachmentSession(runId: string, instanceId: string): string {
    const row = this.instance(runId, instanceId);
    if (!row.sessionId) {
      throw new StageConversationError('STAGE_NOT_STARTED', 'Files can be attached once the stage has started its conversation');
    }
    return row.sessionId;
  }

  /** Send an operator message to the stage (the table in the header). */
  async send(runId: string, instanceId: string, msg: StageMessage): Promise<{ outcome: StageSendOutcome }> {
    const prompt = msg.prompt.trim();
    if (!prompt) throw new StageConversationError('VALIDATION_ERROR', 'The message is empty');
    const row = this.instance(runId, instanceId);
    const turn: OperatorTurn = {
      prompt,
      ...(msg.attachmentIds?.length ? { attachmentIds: msg.attachmentIds } : {}),
      ...(msg.agentMode ? { agentMode: msg.agentMode } : {}),
    };
    const executor = this.engine.executor;
    switch (row.status) {
      case 'awaiting_input':
        throw new StageConversationError(
          'INTERACTION_PENDING',
          'This stage is waiting on your response. Answer or cancel it before sending a new message.',
        );
      case 'starting':
      case 'running':
      case 'validating': {
        const state = executor.frameState(instanceId);
        if (state === 'between_turns' && executor.enqueueOperatorTurn(instanceId, turn)) return { outcome: 'queued' };
        throw new StageConversationError(
          'STAGE_BUSY',
          state === 'mid_turn'
            ? 'This stage is still generating a response. Wait for it to finish, or stop it first.'
            : state === 'closing'
              ? 'This stage is finishing its attempt. Send the message again once it completes (it then amends the output).'
              : 'This stage is running in another process.',
        );
      }
      case 'completed': {
        const { done } = await executor.amend(runId, instanceId, turn);
        this.track(done);
        return { outcome: 'amending' };
      }
      case 'paused': {
        const r = await this.engine.command(runId, {
          command: 'retry',
          instanceId,
          mode: 'resume',
          promptOverride: prompt,
          ...(turn.attachmentIds ? { attachmentIds: turn.attachmentIds } : {}),
          ...(turn.agentMode ? { agentMode: turn.agentMode } : {}),
        });
        if (!r.ok) throw refused(r);
        return { outcome: 'retrying' };
      }
      case 'pending':
      case 'ready':
      case 'retry_wait':
      case 'waiting':
        throw new StageConversationError('STAGE_NOT_STARTED', `The stage has not started its conversation yet (it is ${row.status})`);
      default:
        throw new StageConversationError(
          'STAGE_NOT_CONVERSABLE',
          `A ${row.status} stage is final. Re-run it from here (a fork of the run) to continue its work.`,
        );
    }
  }

  /** Stop the stage's turn in flight without failing the stage (chat parity). */
  cancelTurn(runId: string, instanceId: string, opts: { force?: boolean } = {}): void {
    this.instance(runId, instanceId);
    if (!this.engine.executor.cancelTurn(instanceId, opts)) {
      throw new StageConversationError('NO_ACTIVE_TURN', 'The stage has no turn in flight');
    }
  }

  /** Answer the in-turn gate the stage is waiting on (the `approve` command, checked against the interaction). */
  async resolveInteraction(runId: string, instanceId: string, interactionId: string, answer: StageGateAnswer): Promise<void> {
    const row = this.instance(runId, instanceId);
    const stage = await this.deps.stageRuns.getById(instanceId);
    const pending = (stage.interruptData && typeof stage.interruptData === 'object' ? stage.interruptData : {}) as { kind?: string; interactionId?: string };
    if (row.status !== 'awaiting_input' || pending.interactionId !== interactionId) {
      throw new StageConversationError('INTERACTION_STALE', 'The stage is not waiting on this interaction (it was answered, expired or superseded)');
    }
    if (pending.kind !== GATE_KIND[answer.kind]) {
      throw new StageConversationError('VALIDATION_ERROR', `Interaction ${interactionId} is a ${pending.kind ?? 'different'} gate, not a ${GATE_KIND[answer.kind]}`);
    }
    const r = await this.engine.command(runId, approveCommand(instanceId, interactionId, answer));
    if (!r.ok) throw refused(r);
  }

  /** Resolves once every amendment in flight has settled (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  private track(p: Promise<void>): void {
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }
}

/**
 * A gate answer as the `approve` command. A denied tool call or a declined
 * plan is `changes_requested` — the turn carries on with the refusal —
 * never `rejected`, which fails the stage.
 */
function approveCommand(instanceId: string, interactionId: string, answer: StageGateAnswer): RunCommand {
  switch (answer.kind) {
    case 'permission':
      return {
        command: 'approve',
        instanceId,
        outcome: answer.behavior === 'allow' ? 'approved' : 'changes_requested',
        data: { interactionId, ...(answer.message ? { message: answer.message } : {}) },
        ...(answer.message ? { feedback: answer.message } : {}),
      };
    case 'answer':
      return {
        command: 'approve',
        instanceId,
        outcome: 'approved',
        data: { interactionId, answers: answer.answers, ...(answer.freeformResponse ? { freeformResponse: answer.freeformResponse } : {}) },
      };
    case 'plan': {
      const feedback = answer.feedback?.trim() || (answer.approved ? undefined : 'The reviewer declined the plan. Do not implement it.');
      return {
        command: 'approve',
        instanceId,
        outcome: answer.approved ? 'approved' : 'changes_requested',
        data: { interactionId, ...(answer.action ? { action: answer.action } : {}), ...(feedback ? { feedback } : {}) },
        ...(feedback ? { feedback } : {}),
      };
    }
  }
}

/** A refused engine command, as the conversation API's error. */
function refused(r: Extract<CommandResult, { ok: false }>): StageConversationError {
  switch (r.code) {
    case 'not_found':
      return new StageConversationError('NOT_FOUND', r.message);
    case 'engine_unavailable':
      return new StageConversationError('ENGINE_UNAVAILABLE', r.message);
    case 'invalid_command':
      return new StageConversationError('VALIDATION_ERROR', r.message);
    case 'invalid_state':
      return new StageConversationError('STAGE_NOT_CONVERSABLE', r.message);
    default:
      return new StageConversationError('STAGE_BUSY', r.message);
  }
}

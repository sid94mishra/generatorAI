// ────────────────────────────────────────────────────────────────
// AgentInteractionService (PLN-01)
//
// A durable, chat-scoped human-interaction gate.
//
// This is deliberately SEPARATE from `HitlService` rather than a refactor of
// it. They look similar but have fundamentally different recovery semantics:
//
//   HitlService (stage runs)  — a parked stage row survives a restart and the
//                               scheduler simply re-runs the stage.
//   AgentInteractionService   — a chat gate blocks an in-memory SDK callback
//                               (Copilot `onExitPlanModeRequest`, Claude
//                               `canUseTool`). That callback does NOT survive
//                               a restart, so a "resumed" gate would be a lie.
//                               Pending chat gates are therefore EXPIRED on
//                               boot and the user re-submits.
//
// The in-memory invariants below are copied from HitlService because they were
// hard-won: register the resolver synchronously before any await, persist
// before emitting, and resolve through a conditional DB update.
// ────────────────────────────────────────────────────────────────

import type {
  AgentInteraction,
  AgentInteractionKind,
  AgentInteractionStatus,
} from '@generatorai/shared';
import { generateId } from '@generatorai/shared';
import type { IAgentInteractionRepository } from '../domain/ports/IPlanRepository.js';

export interface InteractionLogger {
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
}

export type InteractionScope =
  | { kind: 'chat'; chatId: string; sessionId: string; turnId: string }
  | { kind: 'stage_run'; stageRunId: string; workflowRunId: string };

export interface OpenInteractionOptions {
  /** Wall-clock budget for the gate. Defaults to the service-wide max age. */
  timeoutMs?: number;
}

export interface InteractionOutcome<T> {
  status: AgentInteractionStatus;
  value?: T;
  reason?: string;
}

export interface AgentInteractionServiceConfig {
  /** How long a gate may stay pending before the sweeper expires it. */
  maxAgeMs?: number;
  /** Sweep cadence. Set to 0 to disable the sweeper (tests). */
  sweepIntervalMs?: number;
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_SWEEP_INTERVAL_MS = 60_000; // 1m

export class AgentInteractionService {
  /** interactionId → resolver. Lost on restart, which is why we expire on boot. */
  private readonly waiters = new Map<string, (outcome: InteractionOutcome<unknown>) => void>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private readonly maxAgeMs: number;

  constructor(
    private readonly repo: IAgentInteractionRepository,
    private readonly onEvent?: (
      event:
        | { type: 'opened'; interaction: AgentInteraction }
        | { type: 'resolved'; interaction: AgentInteraction; status: AgentInteractionStatus }
        | { type: 'expired'; interactionId: string; chatId?: string; reason: string },
    ) => void | Promise<void>,
    private readonly logger?: InteractionLogger,
    config: AgentInteractionServiceConfig = {},
  ) {
    this.maxAgeMs = config.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const interval = config.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (interval > 0) {
      this.sweepTimer = setInterval(() => {
        void this.sweepExpired();
      }, interval);
      this.sweepTimer.unref?.();
    }
  }

  /**
   * Opens a gate and BLOCKS until a human resolves it (or it is cancelled or
   * expires). Callers are provider callbacks, so the returned promise directly
   * holds the agent turn open.
   */
  async open<T>(
    scope: InteractionScope,
    kind: AgentInteractionKind,
    payload: unknown,
    options: OpenInteractionOptions = {},
  ): Promise<InteractionOutcome<T>> {
    const id = generateId();

    // Register the resolver BEFORE any await. If we awaited the DB write first,
    // a concurrent cancel could resolve nothing and this promise would dangle
    // forever, wedging the agent turn.
    const promise = new Promise<InteractionOutcome<T>>((resolve) => {
      this.waiters.set(id, resolve as (outcome: InteractionOutcome<unknown>) => void);
    });

    const timeoutMs = options.timeoutMs ?? this.maxAgeMs;
    const expiresAt = new Date(Date.now() + timeoutMs);

    try {
      const interaction = await this.repo.create({
        id,
        scopeKind: scope.kind,
        scopeId: scope.kind === 'chat' ? scope.chatId : scope.stageRunId,
        ...(scope.kind === 'chat'
          ? { chatId: scope.chatId, sessionId: scope.sessionId, turnId: scope.turnId }
          : {}),
        kind,
        payload,
        expiresAt,
      });
      await this.onEvent?.({ type: 'opened', interaction });
      this.logger?.info?.('[AgentInteraction] opened', { id, kind, scope: scope.kind });
    } catch (err) {
      // Failing to persist must not leave a dangling waiter.
      this.waiters.delete(id);
      throw err;
    }

    return promise;
  }

  /**
   * Resolves a gate. Returns `{ ok: false }` when the row was already
   * terminal — the caller answers 409 rather than mutating a settled decision.
   */
  async resolve(
    interactionId: string,
    status: AgentInteractionStatus,
    resolution: unknown,
  ): Promise<{ ok: boolean; reason?: string }> {
    const won = await this.repo.resolve(interactionId, status, resolution);
    if (!won) {
      const existing = await this.repo.findById(interactionId);
      return {
        ok: false,
        reason: existing
          ? `Interaction already ${existing.status}`
          : 'Interaction not found',
      };
    }

    const interaction = await this.repo.findById(interactionId);
    if (interaction) {
      await this.onEvent?.({ type: 'resolved', interaction, status });
    }

    this.settle(interactionId, { status, value: resolution });
    this.logger?.info?.('[AgentInteraction] resolved', { id: interactionId, status });
    return { ok: true };
  }

  /** Cancels every pending gate for a turn. Used by the chat cancel path. */
  async cancelForTurn(chatId: string, turnId: string, reason: string): Promise<string[]> {
    const ids = await this.repo.cancelForTurn(chatId, turnId, reason);
    for (const id of ids) {
      this.settle(id, { status: 'cancelled', reason });
      await this.onEvent?.({ type: 'expired', interactionId: id, chatId, reason });
    }
    return ids;
  }

  /** Cancels every pending gate for a chat (archive / delete paths). */
  async cancelForChat(chatId: string, reason: string): Promise<string[]> {
    const ids = await this.repo.cancelForChat(chatId, reason);
    for (const id of ids) {
      this.settle(id, { status: 'cancelled', reason });
      await this.onEvent?.({ type: 'expired', interactionId: id, chatId, reason });
    }
    return ids;
  }

  async listPendingByChat(chatId: string): Promise<AgentInteraction[]> {
    return this.repo.listPendingByChat(chatId);
  }

  async findById(interactionId: string): Promise<AgentInteraction | null> {
    return this.repo.findById(interactionId);
  }

  /**
   * Boot-time recovery. A pending CHAT gate references an SDK callback that
   * did not survive the restart, so it can never be honestly resumed.
   *
   * On a real restart there are no in-process waiters, but we settle any we do
   * own: if this is ever called mid-life (defensive re-run, test), a surviving
   * waiter would otherwise block its provider callback forever.
   */
  async expireOrphans(): Promise<number> {
    const ids = await this.repo.expireAllPendingChatGates('server_restart');
    for (const id of ids) {
      this.settle(id, { status: 'expired', reason: 'server_restart' });
      await this.onEvent?.({ type: 'expired', interactionId: id, reason: 'server_restart' });
    }
    if (ids.length > 0) {
      this.logger?.warn?.(
        `[AgentInteraction] expired ${ids.length} orphaned chat gate(s) after restart`,
      );
    }
    return ids.length;
  }

  /** Runtime expiry of abandoned gates (not only at boot). */
  async sweepExpired(): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - this.maxAgeMs);
      const ids = await this.repo.expireStale(cutoff);
      for (const id of ids) {
        this.settle(id, { status: 'expired', reason: 'timeout' });
        await this.onEvent?.({ type: 'expired', interactionId: id, reason: 'timeout' });
      }
      return ids.length;
    } catch (err) {
      this.logger?.warn?.('[AgentInteraction] sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  /** Stops the background sweeper. */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  /** Resolves the in-memory waiter, if this process owns it. */
  private settle(interactionId: string, outcome: InteractionOutcome<unknown>): void {
    const waiter = this.waiters.get(interactionId);
    if (!waiter) return;
    this.waiters.delete(interactionId);
    waiter(outcome);
  }
}

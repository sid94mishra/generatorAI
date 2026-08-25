/**
 * W12 — Agent Host server process.
 *
 * Runs as a child process of the gateway. Receives requests over the IPC
 * channel (process.on('message')), executes them against the provider
 * harness, and sends responses back (process.send()).
 *
 * L5: Native handles (provider runtimes) never live in the control-plane
 * process. This file IS the control-plane boundary.
 */

import type {
  AgentHostRequest,
  AgentHostResponse,
  AgentEventNotification,
  SessionEndedNotification,
} from '@generatorai/shared';
import { isAgentHostRequest } from '@generatorai/shared';
import type { ILogger } from '@generatorai/shared';
import type { IAgentHarness } from '@generatorai/core';
import { RuntimeSupervisor } from './RuntimeSupervisor.js';

/** Map from sessionId → runtimeId (which runtime owns this session). */
type SessionOwnerMap = Map<string, string>;

export class AgentHostServer {
  /* W12 */
  private readonly supervisor: RuntimeSupervisor;
  private readonly sessionOwners: SessionOwnerMap = new Map();
  /** B2-fix: maps IPC sessionId → harness conversationId. */
  private readonly sessionConversations = new Map<string, string>();
  private readonly bootTime = Date.now();
  private readonly logger: ILogger;

  /**
   * M5-fix: tracks the active waitForTurnEnd unsub per session.
   * A second send_turn cancels the prior listener before registering a new one
   * so that only one terminal event is emitted per session.
   */
  private readonly turnEndUnsubs = new Map<string, () => void>();

  constructor(logger: ILogger) {
    this.logger = logger;
    this.supervisor = new RuntimeSupervisor(logger);
  }

  /** Register a provider harness (called during host boot). */
  registerHarness(harness: IAgentHarness): void {
    this.supervisor.register(harness);
  }

  /** Start listening on the IPC channel. */
  start(): void {
    if (typeof process.send !== 'function') {
      throw new Error('[AgentHostServer] Not running as a forked child process — process.send unavailable');
    }

    process.on('message', (raw: unknown) => {
      if (!isAgentHostRequest(raw)) {
        this.logger.warn('[AgentHostServer] Received unrecognised IPC message type');
        return;
      }
      this.handleRequest(raw as AgentHostRequest).catch((err: unknown) => {
        this.logger.error(`[AgentHostServer] Unhandled error in handleRequest: ${String(err)}`);
      });
    });

    this.send({ type: 'pong', reqId: '__ready__' } as AgentHostResponse);
    this.logger.info('[AgentHostServer] Agent host ready');
  }

  private send(msg: AgentHostResponse): void {
    // process.send is guaranteed non-null because start() checked it
    process.send!(msg);
  }

  private async handleRequest(req: AgentHostRequest): Promise<void> {
    switch (req.type) {
      case 'ping':
        this.send({ type: 'pong', reqId: req.reqId });
        return;

      case 'get_stats': {
        const s = this.supervisor.stats();
        this.send({
          type: 'stats',
          reqId: req.reqId,
          activeSessions: this.sessionOwners.size,
          rssBytes: s.rssBytes,
          uptimeMs: Date.now() - this.bootTime,
          providerCount: s.runtimeCount,
        });
        return;
      }

      case 'spawn_session': {
        const { reqId, sessionId, params } = req;
        const runtime = this.supervisor.pickRuntime();
        if (!runtime) {
          this.send({ type: 'error', reqId, ok: false, message: 'No provider runtime available', code: 'NO_RUNTIME' });
          return;
        }
        try {
          // Re-hydrate params and create the conversation in the provider
          const conversationId = await runtime.harness.createConversation(
            params as unknown as Parameters<IAgentHarness['createConversation']>[0],
          );

          // Subscribe to events BEFORE committing state so we don't miss events
          // on a race between createConversation and the first real event.
          const unsubscribe = runtime.harness.onConversationEvent(conversationId, (event) => {
            const notification: AgentEventNotification = {
              type: 'agent_event',
              sessionId,
              event,
            };
            this.send(notification);
          });

          // B3-fix: commit ALL state AFTER all can-throw operations succeed.
          this.sessionConversations.set(sessionId, conversationId);
          this.sessionOwners.set(sessionId, runtime.id);
          runtime.sessionCount++;
          // Store unsub for teardown
          (this as unknown as Record<string, unknown>)[`_unsub_${sessionId}`] = unsubscribe;

          this.send({ type: 'ack', reqId, ok: true });
        } catch (err: unknown) {
          this.send({ type: 'error', reqId, ok: false, message: String(err), code: 'SPAWN_FAILED' });
        }
        return;
      }

      case 'send_turn': {
        const { reqId, sessionId, prompt, attachments } = req;
        const runtimeId = this.sessionOwners.get(sessionId);
        const runtime = runtimeId ? this.supervisor.get(runtimeId) : undefined;
        // B2-fix: resolve the harness-level conversationId from the IPC sessionId.
        const conversationId = this.sessionConversations.get(sessionId);
        if (!runtime || !conversationId) {
          this.send({ type: 'error', reqId, ok: false, message: `No runtime for session ${sessionId}`, code: 'SESSION_NOT_FOUND' });
          return;
        }
        try {
          // Fire-and-forget: sendPrompt is streaming; events come back via onConversationEvent
          await runtime.harness.sendPrompt(conversationId, prompt, attachments as never);
          this.send({ type: 'ack', reqId, ok: true });
          // When the turn completes the harness emits terminal events;
          // we emit session_ended when we see chat.message_complete or harness.error.
          // M5-fix: cancel any prior waitForTurnEnd before registering a new one.
          this.waitForTurnEnd(sessionId, conversationId, runtime.harness);
        } catch (err: unknown) {
          this.send({ type: 'error', reqId, ok: false, message: String(err), code: 'SEND_FAILED' });
        }
        return;
      }

      case 'abort_session': {
        const { reqId, sessionId } = req;
        const runtimeId = this.sessionOwners.get(sessionId);
        const runtime = runtimeId ? this.supervisor.get(runtimeId) : undefined;
        // B2-fix: use conversationId, not sessionId, for harness calls.
        const conversationId = this.sessionConversations.get(sessionId);
        if (!runtime || !conversationId) {
          this.send({ type: 'error', reqId, ok: false, message: `No runtime for session ${sessionId}`, code: 'SESSION_NOT_FOUND' });
          return;
        }
        try {
          await runtime.harness.abortConversation(conversationId);
          this.send({ type: 'ack', reqId, ok: true });
        } catch (err: unknown) {
          this.send({ type: 'error', reqId, ok: false, message: String(err), code: 'ABORT_FAILED' });
        }
        return;
      }

      case 'delete_session': {
        const { reqId, sessionId } = req;
        const runtimeId = this.sessionOwners.get(sessionId);
        const runtime = runtimeId ? this.supervisor.get(runtimeId) : undefined;
        // B2-fix: use conversationId for harness call.
        const conversationId = this.sessionConversations.get(sessionId);
        if (runtime && conversationId) {
          try {
            await runtime.harness.deleteConversation(conversationId);
            runtime.sessionCount = Math.max(0, runtime.sessionCount - 1);
          } catch (err: unknown) {
            this.logger.warn(`[AgentHostServer] deleteConversation error for ${sessionId}: ${String(err)}`);
          }
          this.teardownSession(sessionId);
          runtime.demux.remove(sessionId);
        }
        this.sessionOwners.delete(sessionId);
        this.sessionConversations.delete(sessionId);
        this.send({ type: 'ack', reqId, ok: true });
        return;
      }

      default: {
        const unknown = req as { type: string; reqId?: string };
        this.logger.warn(`[AgentHostServer] Unknown request type: ${unknown.type}`);
        if (unknown.reqId) {
          this.send({ type: 'error', reqId: unknown.reqId, ok: false, message: `Unknown type: ${unknown.type}` });
        }
      }
    }
  }

  /**
   * Wait for terminal events from the harness on `conversationId`, then emit
   * session_ended keyed by `sessionId`.
   *
   * M5-fix: cancels any prior listener for this session before registering
   * a new one, so at most one terminal notification is sent per session.
   *
   * B2-fix: listens on `conversationId` (harness key) not `sessionId` (IPC key).
   */
  private waitForTurnEnd(sessionId: string, conversationId: string, harness: IAgentHarness): void {
    // Cancel prior listener to prevent duplicate session_ended messages
    this.turnEndUnsubs.get(sessionId)?.();
    this.turnEndUnsubs.delete(sessionId);

    const unsubscribe = harness.onConversationEvent(conversationId, (event) => {
      const kind = (event as { kind?: string }).kind ?? '';
      let ended: SessionEndedNotification | null = null;

      if (kind === 'chat.message_complete' || kind === 'harness.idle') {
        ended = { type: 'session_ended', sessionId, reason: 'complete' };
      } else if (kind === 'harness.cancelled') {
        ended = { type: 'session_ended', sessionId, reason: 'cancelled' };
      } else if (kind === 'harness.error') {
        const err = (event as { data?: { message?: string } }).data?.message ?? 'Unknown error';
        ended = { type: 'session_ended', sessionId, reason: 'error', error: err };
      }

      if (ended) {
        unsubscribe();
        this.turnEndUnsubs.delete(sessionId);
        this.send(ended);
      }
    });

    this.turnEndUnsubs.set(sessionId, unsubscribe);
  }

  private teardownSession(sessionId: string): void {
    // Cancel any pending turn-end listener
    this.turnEndUnsubs.get(sessionId)?.();
    this.turnEndUnsubs.delete(sessionId);

    // Cancel the spawn-time event subscription
    const unsubKey = `_unsub_${sessionId}`;
    const unsub = (this as unknown as Record<string, unknown>)[unsubKey] as (() => void) | undefined;
    if (typeof unsub === 'function') {
      unsub();
      delete (this as unknown as Record<string, unknown>)[unsubKey];
    }
  }

  async shutdown(): Promise<void> {
    // Cancel all pending listeners before stopping
    for (const sessionId of this.turnEndUnsubs.keys()) {
      this.teardownSession(sessionId);
    }
    await this.supervisor.shutdown();
    this.sessionOwners.clear();
    this.sessionConversations.clear();
    this.logger.info('[AgentHostServer] Shutdown complete');
  }
}

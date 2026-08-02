// ────────────────────────────────────────────────────────────────
// SessionService — session lifecycle management
// ────────────────────────────────────────────────────────────────

import type {
  Session,
  CreateSessionParams,
} from '@generatorai/shared';
import {
  generateId,
  ResourceLimitError,
} from '@generatorai/shared';
import type { ISessionRepository } from '../domain/ports/IRepositories.js';
import type { IAgentHarness } from '../domain/ports/IAgentHarness.js';
import { SessionStateMachine } from '../domain/state-machines/SessionStateMachine.js';
import type { EventBus } from '../events/EventBus.js';

export class SessionService {
  private maxConcurrentSessions: number;

  constructor(
    private sessionRepo: ISessionRepository,
    private eventBus: EventBus,
    private harness: IAgentHarness,
    options?: { maxConcurrentSessions?: number },
  ) {
    this.maxConcurrentSessions = options?.maxConcurrentSessions ?? 10;
  }

  /** Create a new session. */
  async createSession(params: CreateSessionParams): Promise<Session> {
    const sessionId = generateId();
    const now = new Date();

    const session: Session = {
      id: sessionId,
      name: params.name,
      description: params.description,
      status: 'created',
      model: params.model,
      tags: params.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };

    await this.sessionRepo.create(session);

    await this.eventBus.emit(sessionId, {
      kind: 'session.created',
      data: { sessionId, name: session.name },
    });

    return session;
  }

  /** Start a session — transitions from created to active. */
  async startSession(sessionId: string): Promise<void> {
    // Check concurrency limit
    const activeSessions = await this.sessionRepo.countByStatus(['active']);
    if (activeSessions >= this.maxConcurrentSessions) {
      throw new ResourceLimitError(
        `Maximum concurrent sessions (${this.maxConcurrentSessions}) reached. ` +
          `Pause or complete an existing session first.`,
      );
    }

    const session = await this.sessionRepo.getById(sessionId);
    const sm = new SessionStateMachine(session.status);
    sm.transition('sys:activate');
    await this.sessionRepo.updateStatus(sessionId, sm.status);

    await this.eventBus.emit(sessionId, {
      kind: 'session.active',
      data: { sessionId },
    });
  }

  /** Pause a running session. */
  async pauseSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.getById(sessionId);
    const sm = new SessionStateMachine(session.status);
    sm.transition('user:pause');

    await this.sessionRepo.updateStatus(sessionId, sm.status);
    await this.eventBus.emit(sessionId, {
      kind: 'session.paused',
      data: { sessionId },
    });
  }

  /** Resume a paused session. */
  async resumeSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.getById(sessionId);
    const sm = new SessionStateMachine(session.status);
    sm.transition('user:resume');
    await this.sessionRepo.updateStatus(sessionId, sm.status);

    await this.eventBus.emit(sessionId, {
      kind: 'session.active',
      data: { sessionId },
    });
  }

  /** Cancel a session. */
  async cancelSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.getById(sessionId);
    const sm = new SessionStateMachine(session.status);
    sm.transition('user:close');
    await this.sessionRepo.updateStatus(sessionId, sm.status);

    sm.transition('sys:cleanup_done');
    await this.sessionRepo.updateStatus(sessionId, sm.status);

    await this.eventBus.emit(sessionId, {
      kind: 'session.closed',
      data: { sessionId },
    });
  }

  /** Delete a session and all its data. */
  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.getById(sessionId);
    const sm = new SessionStateMachine(session.status);

    // If the session is active or paused, close it first
    if (sm.canTransition('user:close')) {
      sm.transition('user:close');
      await this.sessionRepo.updateStatus(sessionId, sm.status);

      // Complete cleanup
      if (sm.canTransition('sys:cleanup_done')) {
        sm.transition('sys:cleanup_done');
        await this.sessionRepo.updateStatus(sessionId, sm.status);
      }
    }

    // Best-effort cleanup of any attached harness conversation.
    if (session.conversationId) {
      try {
        await this.harness.destroyConversation(session.conversationId);
      } catch {
        // best-effort
      }
    }

    await this.sessionRepo.delete(sessionId);

    // Clean up orphan event rows (no FK cascade on events table)
    await this.eventBus.deleteSessionEvents(sessionId);
  }

  /** Get a session by ID. */
  async getSession(sessionId: string): Promise<Session> {
    return this.sessionRepo.getById(sessionId);
  }

  /** Get all sessions. */
  async getSessions(): Promise<Session[]> {
    return this.sessionRepo.getAll();
  }
}

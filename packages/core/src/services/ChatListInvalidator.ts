// ────────────────────────────────────────────────────────────────
// ChatListInvalidator — `chat.updated` for writes that change what a chat
// list row shows without touching the chat itself (P1-review P2-R33).
//
// A row's own list-visible fields are announced where they are written
// (`PATCH /chats/:id`, the summary columns in ChatManagementService and
// ChatChangeStatsService). Two indirect writes are announced here:
//   - an agent is renamed or deleted (`agent.updated` / `agent.deleted` on the
//     global path): every chat bound to its ref shows `summary.agent` from it;
//   - a project is deleted: its chats lose `project_id` in the same statement
//     that deletes it, so they are collected BEFORE the delete. The attention
//     feed also re-reads whatever it showed under that project (workflow runs
//     included — their definitions are unlinked the same way).
// Each affected chat gets the usual per-chat `chat.updated`; the attention
// feed treats it as a trigger to re-read that chat.
// ────────────────────────────────────────────────────────────────

import type { AgentEvent, Chat, ILogger, PersistedEvent } from '@generatorai/shared';
import type { IChatRepository } from '../domain/ports/IChatRepository.js';

export interface ChatListInvalidatorDeps {
  eventBus: {
    subscribeGlobal(handler: (event: PersistedEvent) => void): () => void;
    emit(sessionId: string, event: AgentEvent): Promise<unknown>;
  };
  chats: Pick<IChatRepository, 'getByAgentRef' | 'getByProjectId'>;
  attention?: { refreshProject(projectId: string): void };
  logger?: Pick<ILogger, 'warn'>;
}

const AGENT_KINDS: ReadonlySet<string> = new Set(['agent.updated', 'agent.deleted']);

export class ChatListInvalidator {
  private unsubscribe: (() => void) | undefined;
  /** In-flight announcements, so tests and shutdown can wait for them. */
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly deps: ChatListInvalidatorDeps) {}

  start(): void {
    this.unsubscribe ??= this.deps.eventBus.subscribeGlobal((event) => {
      if (!AGENT_KINDS.has(event.kind)) return;
      const ref = (event.data as { ref?: unknown } | undefined)?.ref;
      if (typeof ref === 'string' && ref) this.track(this.agentChanged(ref));
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Resolves once every announcement started so far has been emitted. */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /**
   * Runs `remove` (the project delete) and announces every chat it unlinked.
   * The chats are read first: afterwards nothing links them to the project.
   */
  async deleteProject(projectId: string, remove: () => Promise<void>): Promise<void> {
    const affected = await this.deps.chats.getByProjectId(projectId);
    await remove();
    await this.announce(affected);
    this.deps.attention?.refreshProject(projectId);
  }

  private async agentChanged(ref: string): Promise<void> {
    try {
      await this.announce(await this.deps.chats.getByAgentRef(ref));
    } catch (err) {
      this.deps.logger?.warn('[ChatList] could not announce the chats of a changed agent', {
        ref,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Best effort per chat: one failed emit must not hide the others. */
  private async announce(chats: readonly Pick<Chat, 'id' | 'sessionId'>[]): Promise<void> {
    for (const chat of chats) {
      try {
        await this.deps.eventBus.emit(chat.sessionId, { kind: 'chat.updated', data: { chatId: chat.id } });
      } catch (err) {
        this.deps.logger?.warn('[ChatList] could not announce a chat update', {
          chatId: chat.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private track(work: Promise<void>): void {
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
  }
}

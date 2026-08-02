// ────────────────────────────────────────────────────────────────
// IChatRepository — Port for Chat entity persistence
// ────────────────────────────────────────────────────────────────

import type { Chat, ChatStatus, BackgroundTaskStatus } from '@generatorai/shared';

export interface IChatRepository {
  create(chat: Chat): Promise<Chat>;
  getById(id: string): Promise<Chat>;
  getAll(): Promise<Chat[]>;
  getByStatus(status: ChatStatus): Promise<Chat[]>;
  getByProjectId(projectId: string): Promise<Chat[]>;
  update(id: string, updates: Partial<Chat>): Promise<Chat>;
  updateStatus(id: string, status: ChatStatus): Promise<void>;
  delete(id: string): Promise<void>;
  /** List all WORKER chats spawned by a given orchestrator chat. */
  listBackgroundTasks(parentChatId: string): Promise<Chat[]>;
  /** Update just the background-task status of a worker chat. */
  updateBackgroundTaskStatus(id: string, status: BackgroundTaskStatus): Promise<void>;
}

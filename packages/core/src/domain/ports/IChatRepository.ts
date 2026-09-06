// ────────────────────────────────────────────────────────────────
// IChatRepository — Port for Chat entity persistence
// ────────────────────────────────────────────────────────────────

import type { Chat, ChatStatus, BackgroundTaskStatus } from '@generatorai/shared';

export interface IChatRepository {
  create(chat: Chat): Promise<Chat>;
  getById(id: string): Promise<Chat>;
  getAll(): Promise<Chat[]>;
  getByStatus(status: ChatStatus): Promise<Chat[]>;
  /** `COUNT(*)` of chats in `status` — for health/dashboard tiles that only need the number. */
  countByStatus(status: ChatStatus): Promise<number>;
  getByProjectId(projectId: string): Promise<Chat[]>;
  update(id: string, updates: Partial<Chat>): Promise<Chat>;
  updateStatus(id: string, status: ChatStatus): Promise<void>;
  delete(id: string): Promise<void>;
  /** List all WORKER chats spawned by a given orchestrator chat. */
  listBackgroundTasks(parentChatId: string): Promise<Chat[]>;
  /** Update just the background-task status of a worker chat. */
  updateBackgroundTaskStatus(id: string, status: BackgroundTaskStatus): Promise<void>;
  /**
   * W24 fix — durable orchestrator termination state. Returns `null` when
   * the orchestrator chat has never recorded a wave (fresh orchestration).
   */
  getOrchestratorWaveState(chatId: string): Promise<{ waveCount: number; startedAt: number } | null>;
  /** Persist the orchestrator's wave count + start time (see above). */
  setOrchestratorWaveState(chatId: string, state: { waveCount: number; startedAt: number }): Promise<void>;
  /** Clear the orchestrator's wave state back to "never started" (called on archive). */
  clearOrchestratorWaveState(chatId: string): Promise<void>;
}

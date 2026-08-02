// ────────────────────────────────────────────────────────────────
// ChatFacade — ai.chat.*
// ────────────────────────────────────────────────────────────────

import type { CoreServices, IChatRepository } from '@generatorai/core';
import type { Chat, ChatStatus, PersistedEvent } from '@generatorai/shared';

export interface CreateChatOptions {
  name: string;
  description?: string;
  model?: string;
  projectId?: string;
  tags?: string[];
}

export class ChatFacade {
  constructor(
    private services: CoreServices,
    private chatRepo: IChatRepository,
  ) {}

  /** Create a new chat session */
  async create(options: CreateChatOptions): Promise<Chat> {
    return this.services.chatManagementService.createChat({
      name: options.name,
      description: options.description,
      model: options.model,
      projectId: options.projectId,
      tags: options.tags,
    });
  }

  /** Send a message (fire-and-forget, subscribe to events for responses) */
  async send(chatId: string, message: string): Promise<void> {
    return this.services.chatManagementService.sendPrompt(chatId, message);
  }

  /** Subscribe to events from a chat session */
  async onMessage(chatId: string, handler: (event: PersistedEvent) => void): Promise<() => void> {
    const chat = await this.chatRepo.getById(chatId);
    return this.services.eventBus.subscribeToChat(chat.sessionId, handler);
  }

  /** List all chats */
  async list(status?: ChatStatus, projectId?: string): Promise<Chat[]> {
    return this.services.chatManagementService.listChats(status, projectId);
  }

  /** Get a chat by ID */
  async get(chatId: string): Promise<Chat> {
    return this.chatRepo.getById(chatId);
  }

  /** Archive a chat */
  async archive(chatId: string): Promise<void> {
    return this.services.chatManagementService.archiveChat(chatId);
  }
}

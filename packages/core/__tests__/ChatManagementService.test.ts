// ────────────────────────────────────────────────────────────────
// ChatManagementService Tests  (P3.13)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatManagementService } from '../src/services/ChatManagementService.js';
import { MockChatRepository } from './MockRepositories.js';
import { MockCopilotPort } from './MockAgentHarness.js';
import { EventBus } from '../src/events/EventBus.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { Session, ChatMessage } from '@generatorai/shared';

// ── Minimal in-memory mock implementations for v1 repositories ──

function createMockSessionRepo(): ISessionRepository {
  const store = new Map<string, Session>();
  return {
    create: vi.fn(async (s: Session) => { store.set(s.id, { ...s }); return { ...s }; }),
    getById: vi.fn(async (id: string) => {
      const s = store.get(id);
      if (!s) throw new Error(`Session ${id} not found`);
      return { ...s };
    }),
    getAll: vi.fn(async () => [...store.values()]),
    getByStatus: vi.fn(async () => []),
    countByStatus: vi.fn(async () => 0),
    getByOwner: vi.fn(async () => []),
    update: vi.fn(async (id: string, updates: Partial<Session>) => {
      const s = store.get(id);
      if (!s) throw new Error(`Session ${id} not found`);
      const updated = { ...s, ...updates };
      store.set(id, updated);
      return updated;
    }),
    updateStatus: vi.fn(async (id: string, status: Session['status']) => {
      const s = store.get(id);
      if (s) s.status = status;
    }),
    delete: vi.fn(async (id: string) => { store.delete(id); }),
  };
}

function createMockMessageRepo(): IChatMessageRepository {
  const messages: ChatMessage[] = [];
  return {
    create: vi.fn(async (msg: ChatMessage) => { messages.push({ ...msg }); return { ...msg }; }),
    getBySessionId: vi.fn(async (sid: string, limit?: number) => {
      const filtered = messages.filter((m) => m.sessionId === sid);
      return limit ? filtered.slice(0, limit) : filtered;
    }),
    getByChatId: vi.fn(async (chatId: string, limit?: number) => {
      const filtered = messages.filter((m) => m.chatId === chatId);
      return limit ? filtered.slice(0, limit) : filtered;
    }),
    deleteBySession: vi.fn(async () => {}),
  };
}

describe('ChatManagementService', () => {
  let service: ChatManagementService;
  let chatRepo: MockChatRepository;
  let sessionRepo: ReturnType<typeof createMockSessionRepo>;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let copilot: MockCopilotPort;
  let eventBus: EventBus;

  beforeEach(() => {
    chatRepo = new MockChatRepository();
    sessionRepo = createMockSessionRepo();
    messageRepo = createMockMessageRepo();
    copilot = new MockCopilotPort();
    eventBus = new EventBus();

    service = new ChatManagementService(
      chatRepo,
      sessionRepo,
      messageRepo,
      copilot,
      eventBus,
    );
  });

  // ── createChat ──

  describe('createChat', () => {
    it('should create a chat entity with active status', async () => {
      const chat = await service.createChat({ name: 'Test Chat' });
      expect(chat.name).toBe('Test Chat');
      expect(chat.status).toBe('active');
      expect(chat.sessionId).toBeDefined();
    });

    it('should create a backing session', async () => {
      await service.createChat({ name: 'S-Chat' });
      expect(sessionRepo.create).toHaveBeenCalledTimes(1);
      expect(sessionRepo.updateStatus).toHaveBeenCalled();
    });

    it('should create a Copilot SDK conversation', async () => {
      await service.createChat({ name: 'SDK Chat' });
      expect(copilot.getCallCount('createConversation')).toBe(1);
    });

    it('should persist the chat in the repository', async () => {
      const chat = await service.createChat({ name: 'Persisted' });
      const fetched = await chatRepo.getById(chat.id);
      expect(fetched.name).toBe('Persisted');
    });

    it('should forward optional params (model, tags)', async () => {
      const chat = await service.createChat({
        name: 'Full',
        model: 'gpt-4.1',
        tags: ['a', 'b'],
      });
      expect(chat.model).toBe('gpt-4.1');
      expect(chat.tags).toEqual(['a', 'b']);
    });
  });

  // ── archiveChat ──

  describe('archiveChat', () => {
    it('should transition chat to archived', async () => {
      const chat = await service.createChat({ name: 'To Archive' });
      await service.archiveChat(chat.id);
      const archived = await chatRepo.getById(chat.id);
      expect(archived.status).toBe('archived');
    });

    it('should abort and destroy the SDK conversation', async () => {
      const chat = await service.createChat({ name: 'Cleanup' });
      await service.archiveChat(chat.id);
      expect(copilot.getCallCount('abortConversation')).toBeGreaterThanOrEqual(1);
      expect(copilot.getCallCount('destroyConversation')).toBeGreaterThanOrEqual(1);
    });

    it('should close the backing session', async () => {
      const chat = await service.createChat({ name: 'Close Session' });
      await service.archiveChat(chat.id);
      expect(sessionRepo.updateStatus).toHaveBeenCalledWith(
        expect.any(String),
        'closed',
      );
    });
  });

  // ── sendPrompt ──

  describe('sendPrompt', () => {
    it('should persist the user message', async () => {
      const chat = await service.createChat({ name: 'Prompt Chat' });
      await service.sendPrompt(chat.id, 'Hello world');
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: chat.id,
          role: 'user',
          content: 'Hello world',
        }),
      );
    });

    it('should call copilot.sendPrompt', async () => {
      const chat = await service.createChat({ name: 'SDK Prompt' });
      await service.sendPrompt(chat.id, 'Do something');
      expect(copilot.getCallCount('sendPrompt')).toBe(1);
    });

    it('should reject prompts on archived chats', async () => {
      const chat = await service.createChat({ name: 'Archived' });
      await service.archiveChat(chat.id);
      await expect(service.sendPrompt(chat.id, 'Nope')).rejects.toThrow(/archived/);
    });

    // A provider may ANNOUNCE a tool call before its arguments have finished
    // streaming, then repeat it with the arguments filled in. The Claude Agent
    // SDK does exactly this: two `harness.tool_start` events per call, same
    // `callId`, the first carrying `args: {}`.
    //
    // Persisting both produced one call the user could see twice — the copy
    // holding the RESULT could not say what the tool was called with, and the
    // copy holding the args stayed `running` forever. `StageExecutionService`
    // already merged these; the chat path did not.
    it('merges a tool call re-announced with the same callId', async () => {
      const chat = await service.createChat({ name: 'Tool dedup' });
      const session = await sessionRepo.getById(chat.sessionId);
      const conversationId = session.conversationId;

      await service.sendPrompt(chat.id, 'write a file');

      const emit = (kind: string, data: Record<string, unknown>): void =>
        copilot.simulateConversationEvent(conversationId, { kind, data } as never);

      emit('harness.tool_start', { tool: 'Write', args: {}, callId: 'toolu_1' });
      emit('harness.tool_start', {
        tool: 'Write',
        args: { file_path: 'hello.txt', content: 'hi' },
        callId: 'toolu_1',
      });
      emit('harness.tool_complete', { tool: 'unknown', callId: 'toolu_1', result: 'written' });
      emit('harness.message_complete', { content: 'Done.' });
      emit('harness.idle', {});

      // The listener is async; let its microtasks drain.
      await new Promise((r) => setTimeout(r, 0));

      const assistant = (messageRepo.create as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((c) => c[0] as ChatMessage)
        .filter((m) => m.role === 'assistant')
        .pop();

      expect(assistant).toBeDefined();
      const toolCalls = assistant!.metadata?.toolCalls ?? [];
      expect(toolCalls).toHaveLength(1);
      // The surviving entry keeps BOTH halves: the args from the second
      // announcement and the result from the completion.
      expect(toolCalls[0]!.tool).toBe('Write');
      expect(toolCalls[0]!.args).toEqual({ file_path: 'hello.txt', content: 'hi' });
      expect(toolCalls[0]!.result).toBe('written');
      expect(toolCalls[0]!.status).toBe('complete');
    });

    // Two genuinely concurrent calls to the same tool must stay separate —
    // de-duplication keys on callId, never on the tool name.
    it('keeps distinct callIds as distinct tool calls', async () => {
      const chat = await service.createChat({ name: 'Two tools' });
      const session = await sessionRepo.getById(chat.sessionId);
      const conversationId = session.conversationId;

      await service.sendPrompt(chat.id, 'read two files');

      const emit = (kind: string, data: Record<string, unknown>): void =>
        copilot.simulateConversationEvent(conversationId, { kind, data } as never);

      emit('harness.tool_start', { tool: 'Read', args: { file_path: 'a.txt' }, callId: 'toolu_a' });
      emit('harness.tool_start', { tool: 'Read', args: { file_path: 'b.txt' }, callId: 'toolu_b' });
      emit('harness.tool_complete', { callId: 'toolu_a', result: 'A' });
      emit('harness.tool_complete', { callId: 'toolu_b', result: 'B' });
      emit('harness.message_complete', { content: 'Read both.' });
      emit('harness.idle', {});

      await new Promise((r) => setTimeout(r, 0));

      const assistant = (messageRepo.create as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((c) => c[0] as ChatMessage)
        .filter((m) => m.role === 'assistant')
        .pop();

      const toolCalls = assistant!.metadata?.toolCalls ?? [];
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls.map((t) => t.result)).toEqual(['A', 'B']);
    });
  });

  // ── getChatHistory ──

  describe('getChatHistory', () => {
    it('should return persisted messages for a chat', async () => {
      const chat = await service.createChat({ name: 'History' });
      await service.sendPrompt(chat.id, 'first');
      await service.sendPrompt(chat.id, 'second');
      const history = await service.getChatHistory(chat.id);
      expect(history.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── listChats ──

  describe('listChats', () => {
    it('should list all chats when no status filter', async () => {
      await service.createChat({ name: 'Chat 1' });
      await service.createChat({ name: 'Chat 2' });
      const all = await service.listChats();
      expect(all.length).toBe(2);
    });

    it('should filter by status', async () => {
      const c1 = await service.createChat({ name: 'A' });
      await service.createChat({ name: 'B' });
      await service.archiveChat(c1.id);
      expect((await service.listChats('active')).length).toBe(1);
      expect((await service.listChats('archived')).length).toBe(1);
    });
  });

  // ── deleteChat ──

  describe('deleteChat', () => {
    it('should remove the chat from the repository', async () => {
      const chat = await service.createChat({ name: 'Delete Me' });
      await service.deleteChat(chat.id);
      await expect(chatRepo.getById(chat.id)).rejects.toThrow();
    });

    it('should call deleteConversation on Copilot SDK', async () => {
      const chat = await service.createChat({ name: 'SDK Delete' });
      await service.deleteChat(chat.id);
      expect(copilot.getCallCount('deleteConversation')).toBeGreaterThanOrEqual(1);
    });

    it('should delete messages and session', async () => {
      const chat = await service.createChat({ name: 'Full Delete' });
      await service.deleteChat(chat.id);
      expect(messageRepo.deleteBySession).toHaveBeenCalled();
      expect(sessionRepo.delete).toHaveBeenCalled();
    });
  });
});


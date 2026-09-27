// ────────────────────────────────────────────────────────────────
// Rewind and fork at the chat-service level.
//
// The provider is a mock, so what is pinned here is the ORCHESTRATION: which
// rows are dropped or copied, what anchors the provider is asked to cut at,
// when the native path is taken versus the synthetic seed, what is persisted
// (provider session id, re-keyed anchors, the seed) and what is emitted.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ChatManagementService } from '../src/services/ChatManagementService.js';
import { MockChatRepository } from './MockRepositories.js';
import { MockAgentHarness } from './MockAgentHarness.js';
import { EventBus } from '../src/events/EventBus.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type {
  ForkConversationOptions,
  ForkConversationResult,
  RewindConversationOptions,
} from '../src/domain/ports/IAgentHarness.js';
import type { ProviderCapabilities } from '../src/domain/ports/IProviderInstance.js';
import type { Session, ChatMessage, AgentEvent } from '@generatorai/shared';

function sessionRepoStub(): ISessionRepository & { store: Map<string, Session> } {
  const store = new Map<string, Session>();
  return {
    store,
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
    update: vi.fn(async (id: string, u: Partial<Session>) => {
      const s = store.get(id)!;
      const next = { ...s, ...u };
      store.set(id, next);
      return next;
    }),
    updateStatus: vi.fn(async (id: string, status: Session['status']) => {
      const s = store.get(id);
      if (s) s.status = status;
    }),
    delete: vi.fn(async (id: string) => { store.delete(id); }),
  };
}

function messageRepoStub(): IChatMessageRepository & { all: ChatMessage[] } {
  const all: ChatMessage[] = [];
  return {
    all,
    create: vi.fn(async (m: ChatMessage) => { all.push({ ...m }); return { ...m }; }),
    getBySessionId: vi.fn(async (sid: string) => all.filter((m) => m.sessionId === sid)),
    getBySessionAndStageRunId: vi.fn(async () => []),
    getByChatId: vi.fn(async (cid: string) => all.filter((m) => m.chatId === cid)),
    countByChatId: vi.fn(async (cid: string) => all.filter((m) => m.chatId === cid).length),
    latestBySessionIds: vi.fn(async () => new Map()),
    deleteBySession: vi.fn(async () => {}),
    deleteByIds: vi.fn(async (ids: readonly string[]) => {
      for (const id of ids) {
        const i = all.findIndex((m) => m.id === id);
        if (i >= 0) all.splice(i, 1);
      }
    }),
    updateMetadata: vi.fn(async (id: string, metadata: ChatMessage['metadata']) => {
      const m = all.find((x) => x.id === id);
      if (m) m.metadata = metadata;
    }),
  };
}

/** A provider that can branch natively and records what it was asked. */
class BranchingHarness extends MockAgentHarness {
  caps: Partial<ProviderCapabilities> = { conversationFork: true, conversationRewind: true };
  forkCalls: Array<{ conversationId: string; options: ForkConversationOptions }> = [];
  rewindCalls: Array<{ conversationId: string; options: RewindConversationOptions }> = [];
  forkResult: ForkConversationResult = { providerSessionId: 'prov-fork-1' };
  rewindResult: ForkConversationResult = { providerSessionId: 'prov-rewound-1' };
  failRewind = false;
  providerIds = new Map<string, string>();

  capabilities(): ProviderCapabilities {
    return {
      vision: false, reasoning: false, reasoningEfforts: [], planMode: false, mcpServers: false,
      approvalGating: 'none', hostTools: 'none', structuredOutput: 'none', skills: 'none', sessionPersistence: true, budgetTracking: false,
      ...this.caps,
    };
  }
  getProviderSessionId(conversationId: string): string | undefined {
    return this.providerIds.get(conversationId);
  }
  async forkConversation(conversationId: string, options: ForkConversationOptions): Promise<ForkConversationResult> {
    this.forkCalls.push({ conversationId, options });
    await this.createConversation({ ...options.params, conversationId: options.newConversationId });
    return this.forkResult;
  }
  async rewindConversation(conversationId: string, options: RewindConversationOptions): Promise<ForkConversationResult> {
    this.rewindCalls.push({ conversationId, options });
    if (this.failRewind) throw new Error('provider says no');
    return this.rewindResult;
  }
}

let seq = 0;
function row(chatId: string, sessionId: string, role: ChatMessage['role'], content: string, meta: ChatMessage['metadata']): ChatMessage {
  seq += 1;
  return { id: `m${seq}`, chatId, sessionId, role, content, metadata: meta, timestamp: new Date(2026, 0, 1, 0, 0, seq) };
}

describe('rewindChat / forkChat', () => {
  let service: ChatManagementService;
  let harness: BranchingHarness;
  let messages: ReturnType<typeof messageRepoStub>;
  let sessions: ReturnType<typeof sessionRepoStub>;
  let bus: EventBus;
  let events: AgentEvent[];

  beforeEach(() => {
    harness = new BranchingHarness();
    messages = messageRepoStub();
    sessions = sessionRepoStub();
    bus = new EventBus();
    events = [];
    bus.subscribeAll((e) => { events.push(e); });
    service = new ChatManagementService(new MockChatRepository(), sessions, messages, harness, bus);
  });

  /** A chat with three completed, anchored turns. */
  async function seededChat() {
    const chat = await service.createChat({ name: 'seed' });
    const session = sessions.store.get(chat.sessionId)!;
    session.providerSessionId = 'prov-orig';
    const s = chat.sessionId;
    const rows = [
      row(chat.id, s, 'user', 'q1', { turnId: 't1' }),
      row(chat.id, s, 'assistant', 'a1', { turnId: 't1', providerAnchor: { kind: 'message', id: 'u1' } }),
      row(chat.id, s, 'user', 'q2', { turnId: 't2' }),
      row(chat.id, s, 'assistant', 'a2', { turnId: 't2', providerAnchor: { kind: 'message', id: 'u2' } }),
      row(chat.id, s, 'user', 'q3', { turnId: 't3' }),
      row(chat.id, s, 'assistant', 'a3', { turnId: 't3', providerAnchor: { kind: 'message', id: 'u3' } }),
    ];
    for (const r of rows) messages.all.push(r);
    return { chat, session, conversationId: session.conversationId! };
  }

  it('rewinds the conversation natively: drops the tail, cuts at the surviving anchor, keeps the prompt', async () => {
    const { chat, conversationId } = await seededChat();
    const result = await service.rewindChat(chat.id, 't2', 'conversation');

    expect(result.conversation).toBe('native');
    expect(result.prompt).toBe('q2');
    expect(messages.all.filter((m) => m.chatId === chat.id).map((m) => m.content)).toEqual(['q1', 'a1']);

    expect(harness.rewindCalls).toHaveLength(1);
    const call = harness.rewindCalls[0]!;
    expect(call.conversationId).toBe(conversationId);
    expect(call.options.keepThrough).toEqual({ kind: 'message', id: 'u1' });
    expect(call.options.dropFrom).toEqual({ kind: 'message', id: 'u2' });
    expect(call.options.droppedTurns).toBe(2);
    expect(call.options.providerSessionId).toBe('prov-orig');
    // The provider re-pointed the conversation; the new handle is persisted.
    expect(sessions.store.get(chat.sessionId)!.providerSessionId).toBe('prov-rewound-1');

    const rewound = events.find((e) => e.kind === 'chat.rewound');
    expect(rewound?.data).toMatchObject({ chatId: chat.id, turnId: 't2', scope: 'conversation', prompt: 'q2', conversation: 'native' });
  });

  it('rewinding to the first turn empties the conversation (keepThrough null)', async () => {
    const { chat } = await seededChat();
    await service.rewindChat(chat.id, 't1', 'conversation');
    expect(messages.all.filter((m) => m.chatId === chat.id)).toHaveLength(0);
    expect(harness.rewindCalls[0]!.options.keepThrough).toBeNull();
    expect(harness.rewindCalls[0]!.options.droppedTurns).toBe(3);
  });

  it('re-keys the surviving anchors when the provider minted new ids', async () => {
    const { chat } = await seededChat();
    harness.rewindResult = { providerSessionId: 'prov-2', anchorMap: { u1: 'v1' } };
    await service.rewindChat(chat.id, 't2', 'conversation');
    const a1 = messages.all.find((m) => m.chatId === chat.id && m.content === 'a1')!;
    expect(a1.metadata?.providerAnchor).toEqual({ kind: 'message', id: 'v1' });
  });

  it('falls back to a synthetic rewind when the provider cannot branch: fresh session + seed', async () => {
    harness.caps = { conversationFork: false, conversationRewind: false };
    const { chat, conversationId } = await seededChat();
    const result = await service.rewindChat(chat.id, 't3', 'conversation');

    expect(result.conversation).toBe('synthetic');
    expect(harness.rewindCalls).toHaveLength(0);
    expect(harness.calls.some((c) => c.method === 'destroyConversation' && c.args[0] === conversationId)).toBe(true);
    expect(sessions.store.get(chat.sessionId)!.providerSessionId).toBe('');
    const stored = await service.getChat(chat.id);
    expect(stored.conversationSeed).toContain('q1');
    expect(stored.conversationSeed).toContain('a2');
    expect(stored.conversationSeed).not.toContain('q3');
  });

  it('falls back to synthetic when the native rewind throws', async () => {
    harness.failRewind = true;
    const { chat } = await seededChat();
    const result = await service.rewindChat(chat.id, 't2', 'all');
    expect(result.conversation).toBe('synthetic');
    expect(harness.rewindCalls).toHaveLength(1);
  });

  it('falls back to synthetic when a surviving turn has no anchor', async () => {
    const { chat } = await seededChat();
    const a1 = messages.all.find((m) => m.chatId === chat.id && m.content === 'a1')!;
    delete a1.metadata!.providerAnchor;
    const result = await service.rewindChat(chat.id, 't2', 'conversation');
    expect(result.conversation).toBe('synthetic');
    expect(harness.rewindCalls).toHaveLength(0);
  });

  it('a code-only rewind leaves the transcript and the provider alone', async () => {
    const { chat } = await seededChat();
    const result = await service.rewindChat(chat.id, 't2', 'code');
    expect(result.conversation).toBe('skipped');
    expect(messages.all.filter((m) => m.chatId === chat.id)).toHaveLength(6);
    expect(harness.rewindCalls).toHaveLength(0);
  });

  it('refuses an unknown turn', async () => {
    const { chat } = await seededChat();
    await expect(service.rewindChat(chat.id, 'nope', 'all')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the seed is prepended to the next prompt exactly once', async () => {
    harness.caps = { conversationFork: false, conversationRewind: false };
    const { chat } = await seededChat();
    await service.rewindChat(chat.id, 't3', 'conversation');
    await service.sendPrompt(chat.id, 'next question');
    const sent = harness.calls.filter((c) => c.method === 'sendPrompt');
    expect(sent).toHaveLength(1);
    const promptText = String(sent[0]!.args[1]);
    expect(promptText).toContain('[Conversation history');
    expect(promptText.endsWith('[New message from the user]\nnext question')).toBe(true);
    expect((await service.getChat(chat.id)).conversationSeed ?? '').toBe('');
  });

  it('forks natively after a chosen turn: new chat, copied rows, anchors re-keyed, provenance set', async () => {
    const { chat, conversationId } = await seededChat();
    harness.forkResult = { providerSessionId: 'prov-fork-1', anchorMap: { u1: 'f1', u2: 'f2' } };
    const result = await service.forkChat(chat.id, { turnId: 't2' });

    expect(result.conversation).toBe('native');
    expect(result.turnId).toBe('t2');
    const fork = result.chat;
    expect(fork.id).not.toBe(chat.id);
    expect(fork.name).toBe('seed (fork)');
    expect(fork.forkedFromChatId).toBe(chat.id);
    expect(fork.forkedAtTurnId).toBe('t2');
    expect(fork.parentChatId).toBeUndefined();

    expect(harness.forkCalls).toHaveLength(1);
    const call = harness.forkCalls[0]!;
    expect(call.conversationId).toBe(conversationId);
    expect(call.options.throughAnchor).toEqual({ kind: 'message', id: 'u2' });
    expect(call.options.sourceProviderSessionId).toBe('prov-orig');
    expect(call.options.newConversationId).toBe(sessions.store.get(fork.sessionId)!.conversationId);

    const copied = messages.all.filter((m) => m.chatId === fork.id);
    expect(copied.map((m) => m.content)).toEqual(['q1', 'a1', 'q2', 'a2']);
    expect(copied.every((m) => m.sessionId === fork.sessionId)).toBe(true);
    expect(copied[1]!.metadata?.providerAnchor).toEqual({ kind: 'message', id: 'f1' });
    expect(copied[3]!.metadata?.providerAnchor).toEqual({ kind: 'message', id: 'f2' });
    expect(sessions.store.get(fork.sessionId)!.providerSessionId).toBe('prov-fork-1');
    // The source is untouched.
    expect(messages.all.filter((m) => m.chatId === chat.id)).toHaveLength(6);
    expect(events.some((e) => e.kind === 'chat.forked')).toBe(true);
  });

  it('forks synthetically when the provider cannot branch', async () => {
    harness.caps = { conversationFork: false, conversationRewind: false };
    const { chat } = await seededChat();
    const result = await service.forkChat(chat.id);
    expect(result.conversation).toBe('synthetic');
    expect(result.turnId).toBe('t3');
    expect(harness.forkCalls).toHaveLength(0);
    const fork = await service.getChat(result.chat.id);
    expect(fork.conversationSeed).toContain('a3');
    expect(messages.all.filter((m) => m.chatId === fork.id)).toHaveLength(6);
  });

  it('refuses to rewind or fork while a turn is in flight', async () => {
    const { chat } = await seededChat();
    void service.sendPrompt(chat.id, 'busy').catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    await expect(service.rewindChat(chat.id, 't2', 'all')).rejects.toMatchObject({ code: 'CHAT_BUSY' });
    await expect(service.forkChat(chat.id)).rejects.toMatchObject({ code: 'CHAT_BUSY' });
  });
});

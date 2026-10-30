// ────────────────────────────────────────────────────────────────
// One chat, several providers — the real routing and the real chat service.
//
// Most high-severity bugs of the 2026-10-17 evaluation lived in the seam
// between `MultiHarness` (which provider owns a conversation) and
// `ChatManagementService` (what a turn sends, records and ends), and each was
// unit-tested on one side only:
//   E-4  a model from another provider never moved the chat
//   E-7  the move handed Claude the Codex thread id to resume
//   E-8  a failed turn left the chat running
//   E-9  the carried history did not say which model wrote each reply
//   E-10 a switched turn that failed lost the carried history
// This drives both together through Codex → Claude → Codex, then a failed
// switch, with scripted providers in place of the CLIs.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';

import { ChatManagementService, EventBus } from '@generatorai/core';
import type { CreateConversationParams, IChatRepository, ISessionRepository, IChatMessageRepository } from '@generatorai/core';
import type { AgentEvent, Chat, ChatMessage, Session } from '@generatorai/shared';

import { MultiHarness } from '../src/MultiHarness.js';
import type { HarnessRegistry } from '../src/HarnessRegistry.js';
import type { HarnessType } from '../src/types.js';

type Handler = (event: AgentEvent) => void;

/** A provider CLI reduced to what the seam observes: sessions, prompts, and the events a turn emits. */
class ScriptedProvider {
  readonly created: CreateConversationParams[] = [];
  readonly prompts: string[] = [];
  readonly destroyed: string[] = [];
  /** The next turn fails the way a provider does: error, then idle. */
  failNext = false;
  private readonly live = new Map<string, string>();
  private readonly handlers = new Map<string, Set<Handler>>();
  private seq = 0;

  constructor(readonly type: HarnessType, private readonly reply: (prompt: string) => string) {}

  async createConversation(p: CreateConversationParams): Promise<string> {
    this.created.push(p);
    const id = p.conversationId!;
    // A resume id this provider never issued is the E-7 failure.
    if (p.resumeProviderSessionId && !p.resumeProviderSessionId.startsWith(`${this.type}-`)) {
      throw new Error(`No conversation found with session ID: ${p.resumeProviderSessionId}`);
    }
    this.live.set(id, p.resumeProviderSessionId ?? `${this.type}-session-${++this.seq}`);
    return id;
  }
  async resumeConversation(id: string, p?: CreateConversationParams): Promise<void> {
    if (!this.live.has(id)) await this.createConversation({ ...p, conversationId: id } as CreateConversationParams);
  }
  async destroyConversation(id: string): Promise<void> {
    this.destroyed.push(id);
    this.live.delete(id);
  }
  hasLiveConversation(id: string): boolean {
    return this.live.has(id);
  }
  getProviderSessionId(id: string): string | undefined {
    return this.live.get(id);
  }
  onConversationEvent(id: string, h: Handler): () => void {
    const set = this.handlers.get(id) ?? new Set<Handler>();
    set.add(h);
    this.handlers.set(id, set);
    return () => set.delete(h);
  }
  async sendPrompt(id: string, prompt: string): Promise<void> {
    this.prompts.push(prompt);
    const fail = this.failNext;
    this.failNext = false;
    const model = this.type === 'codex' ? 'gpt-5.6-terra' : 'claude-sonnet-5-5';
    const emit = (kind: string, data: Record<string, unknown>) => {
      for (const h of this.handlers.get(id) ?? []) h({ kind, data } as unknown as AgentEvent);
    };
    setTimeout(() => {
      if (fail) {
        emit('harness.error', { message: 'The agent session ended before the turn produced a result' });
      } else {
        emit('harness.message_complete', { content: this.reply(prompt) });
        emit('harness.usage', { model, provider: this.type, inputTokens: 10, outputTokens: 5 });
      }
      emit('harness.idle', {});
    }, 1);
  }
  async abortConversation(): Promise<void> {}
  capabilities() {
    return { vision: false, reasoning: false, reasoningEfforts: [], planMode: false, mcpServers: false, approvalGating: 'per_call', hostTools: 'full' };
  }
}

function memoryRepos() {
  const chats = new Map<string, Chat>();
  const sessions = new Map<string, Session>();
  const messages: ChatMessage[] = [];
  const chatRepo = {
    create: async (c: Chat) => (chats.set(c.id, { ...c }), { ...c }),
    getById: async (id: string) => {
      const c = chats.get(id);
      if (!c) throw new Error(`Chat ${id} not found`);
      return { ...c };
    },
    getAll: async () => [...chats.values()],
    update: async (id: string, u: Partial<Chat>) => {
      const next = { ...chats.get(id)!, ...u };
      chats.set(id, next);
      return { ...next };
    },
    updateStatus: async (id: string, status: Chat['status']) => void (chats.get(id)!.status = status),
    touchActivity: async () => undefined,
    recordTurnEnd: async () => undefined,
  } as unknown as IChatRepository;
  const sessionRepo = {
    create: async (s: Session) => (sessions.set(s.id, { ...s }), { ...s }),
    getById: async (id: string) => ({ ...sessions.get(id)! }),
    update: async (id: string, u: Partial<Session>) => {
      const next = { ...sessions.get(id)!, ...u };
      sessions.set(id, next);
      return next;
    },
    updateStatus: async (id: string, status: Session['status']) => void (sessions.get(id)!.status = status),
  } as unknown as ISessionRepository;
  const messageRepo = {
    create: async (m: ChatMessage) => (messages.push({ ...m }), { ...m }),
    getByChatId: async (chatId: string) => messages.filter((m) => m.chatId === chatId),
    getBySessionId: async (sid: string) => messages.filter((m) => m.sessionId === sid),
  } as unknown as IChatMessageRepository;
  return { chatRepo, sessionRepo, messageRepo, messages };
}

describe('one chat moved between providers', () => {
  let codex: ScriptedProvider;
  let claude: ScriptedProvider;
  let harness: MultiHarness;
  let service: ChatManagementService;
  let repos: ReturnType<typeof memoryRepos>;

  beforeEach(() => {
    codex = new ScriptedProvider('codex', (p) => (p.includes('formatDuration') && !p.includes('[Conversation history') ? 'Added formatDuration (ms).' : 'Codex: done.'));
    claude = new ScriptedProvider('claude-agent', () => 'Claude: reviewed, fixed the NaN case.');
    const adapters: Partial<Record<HarnessType, ScriptedProvider>> = { codex, 'claude-agent': claude };
    const registry = {
      primary: 'claude-agent',
      readyTypes: ['claude-agent', 'codex'],
      statusSnapshot: {
        codex: { ready: true, checkedAt: 1, models: [{ id: 'gpt-5.6-terra' }] },
        'claude-agent': { ready: true, checkedAt: 1, models: [{ id: 'claude-sonnet-5-5' }] },
      },
      resolveProviderForModel: async (id: string) => (id.startsWith('gpt') ? 'codex' : id.startsWith('claude') ? 'claude-agent' : null),
      hasInstance: () => false,
      peek: (t: HarnessType) => adapters[t] ?? null,
      get: async (t: HarnessType) => adapters[t],
    } as unknown as HarnessRegistry;
    harness = new MultiHarness(registry);
    repos = memoryRepos();
    service = new ChatManagementService(repos.chatRepo, repos.sessionRepo, repos.messageRepo, harness as never, new EventBus());
  });

  /** Send a prompt and wait until the chat service has closed the turn. */
  async function turn(chatId: string, prompt: string): Promise<void> {
    await service.sendPrompt(chatId, prompt);
    for (let i = 0; i < 200 && service.isTurnActive(chatId); i++) await new Promise((r) => setTimeout(r, 2));
    expect(service.isTurnActive(chatId)).toBe(false);
    expect(service.getStreamingChatIds()).not.toContain(chatId);
  }
  /** What the composer's model picker writes (PATCH /chats/:id). */
  const pick = (chatId: string, model: string, harnessType: HarnessType) =>
    repos.chatRepo.update(chatId, { model, harnessConfig: { harnessType } } as Partial<Chat>);

  it('carries the history across each move, never resumes a foreign session, and records who wrote what', async () => {
    const chat = await service.createChat({ name: 'switch', model: 'gpt-5.6-terra', harnessConfig: { harnessType: 'codex' } } as never);
    await turn(chat.id, 'Add formatDuration.');
    expect(codex.prompts).toHaveLength(1);

    // → Claude (E-4): the conversation moves, the old session is retired, the new one starts fresh (E-7).
    await pick(chat.id, 'claude-sonnet-5-5', 'claude-agent');
    await turn(chat.id, 'Review what Codex just did.');
    expect(codex.destroyed).toHaveLength(1);
    expect(claude.created.at(-1)?.resumeProviderSessionId).toBeUndefined();
    expect(claude.prompts).toHaveLength(1);
    expect(claude.prompts[0]).toContain('Assistant [gpt-5.6-terra · codex]:\nAdded formatDuration (ms).'); // E-9
    expect(claude.prompts[0]).toContain('Review what Codex just did.');

    // → back to Codex: fresh again, carrying both earlier replies with their authors.
    await pick(chat.id, 'gpt-5.6-terra', 'codex');
    await turn(chat.id, 'Summarise the chat.');
    expect(codex.created.at(-1)?.resumeProviderSessionId).toBeUndefined();
    const back = codex.prompts.at(-1)!;
    expect(back).toContain('Assistant [gpt-5.6-terra · codex]:');
    expect(back).toContain('Assistant [claude-sonnet-5-5 · claude-agent]:\nClaude: reviewed, fixed the NaN case.');

    const replies = repos.messages.filter((m) => m.chatId === chat.id && m.role === 'assistant');
    expect(replies.map((m) => `${m.metadata?.model}/${m.metadata?.provider}`)).toEqual([
      'gpt-5.6-terra/codex',
      'claude-sonnet-5-5/claude-agent',
      'gpt-5.6-terra/codex',
    ]);
  });

  it('a switched turn that fails ends the turn and keeps the history for the retry (E-8, E-10)', async () => {
    const chat = await service.createChat({ name: 'switch-fail', model: 'gpt-5.6-terra', harnessConfig: { harnessType: 'codex' } } as never);
    await turn(chat.id, 'Add formatDuration.');

    await pick(chat.id, 'claude-sonnet-5-5', 'claude-agent');
    claude.failNext = true;
    await turn(chat.id, 'Review it.');
    expect((await repos.chatRepo.getById(chat.id)).conversationSeed).toContain('Added formatDuration (ms).');

    await turn(chat.id, 'Try again.');
    expect(claude.prompts.at(-1)).toContain('Added formatDuration (ms).');
    expect(claude.prompts.at(-1)).toContain('Try again.');
    expect((await repos.chatRepo.getById(chat.id)).conversationSeed ?? '').toBe('');
  });
});

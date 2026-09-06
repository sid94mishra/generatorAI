// ────────────────────────────────────────────────────────────────
// Stopping a turn must keep what the user already watched arrive.
//
// Measured live before the fix: a chat streamed 2,586 bytes of an answer, the
// user pressed Stop, and the transcript kept the QUESTION WITH NO ANSWER —
// both on screen and in the database.
//
// The cause was a race between three finalisation routes. `cancelTurn` sets
// the cancelled flag, aborts the provider, and then calls the turn's
// finaliser with `{ partial: true }`. But the abort also drives the provider
// to `harness.idle`, and that handler calls the SAME finaliser with no
// options and then DELETES it from `turnFinalizers`. When idle won:
//   - `turnContent` is empty, because it is only set by `message_complete`,
//     which an aborted turn never sends;
//   - the non-partial path refuses to write a turn with no text;
//   - `cancelTurn`'s later `turnFinalizers.get(chatId)` finds nothing.
// Everything streamed was dropped, and nothing logged a failure.
//
// The fix reads "was this turn cancelled" from the service rather than from
// the caller, so all three routes agree no matter which one wins.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ChatManagementService } from '../src/services/ChatManagementService.js';
import { MockChatRepository } from './MockRepositories.js';
import { MockCopilotPort } from './MockAgentHarness.js';
import { EventBus } from '../src/events/EventBus.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import type { Session, ChatMessage } from '@generatorai/shared';

function sessionRepoStub(): ISessionRepository {
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
    getByChatId: vi.fn(async (cid: string) => all.filter((m) => m.chatId === cid)),
    deleteBySession: vi.fn(async () => {}),
  } as IChatMessageRepository & { all: ChatMessage[] };
}

/**
 * A harness whose prompt never settles on its own — so the turn stays live
 * until the test cancels it — and whose abort makes the provider go idle,
 * which is the ordering that lost the data.
 */
class StallingHarness extends MockCopilotPort {
  idleOnAbort = true;
  /** The conversation the service most recently created. */
  lastConversationId(): string {
    const made = (this as unknown as { calls: Array<{ method: string; args: unknown[] }> }).calls
      .filter((c) => c.method === 'createConversation');
    return (made.at(-1)!.args[0] as { conversationId: string }).conversationId;
  }
  /** Settles the in-flight prompt — a real provider's does, on abort. */
  private release: (() => void) | null = null;
  override async sendPrompt(conversationId: string, prompt: string): Promise<void> {
    (this as unknown as { calls: Array<{ method: string; args: unknown[] }> }).calls.push({
      method: 'sendPrompt',
      args: [conversationId, prompt],
    });
    // Stays in flight until the test aborts, so the turn is genuinely live.
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  override async abortConversation(conversationId: string): Promise<void> {
    await super.abortConversation(conversationId);
    // Leaving the prompt pending would strand the service's `startingTurns`
    // claim (released in a `finally`), so the chat would look busy forever
    // and the NEXT turn could never start — an artefact of the stub, not of
    // the code under test.
    this.release?.();
    this.release = null;
    if (this.idleOnAbort) {
      this.simulateConversationEvent(conversationId, { kind: 'harness.idle', data: {} } as never);
    }
  }
}

describe('cancelling a turn keeps the partial answer', () => {
  let service: ChatManagementService;
  let harness: StallingHarness;
  let messages: ReturnType<typeof messageRepoStub>;

  beforeEach(() => {
    harness = new StallingHarness();
    messages = messageRepoStub();
    service = new ChatManagementService(
      new MockChatRepository(),
      sessionRepoStub(),
      messages,
      harness,
      new EventBus(),
    );
  });

  /** Start a turn, stream `text`, and hand back the chat + conversation ids. */
  async function streamThenReturn(text: string) {
    const chat = await service.createChat({ name: 'stop-me' });
    void service.sendPrompt(chat.id, 'write a long list').catch(() => {});
    // Let the subscription attach before events are pushed at it.
    await new Promise((r) => setTimeout(r, 200));
    
    const conversationId = harness.lastConversationId();
    for (const chunk of text.match(/.{1,20}/g) ?? []) {
      harness.simulateConversationEvent(conversationId, {
        kind: 'harness.token',
        data: { text: chunk },
      } as never);
    }
    // The subscription handler is async (it awaits an event-bus emit before
    // accumulating), so the tokens need a tick to reach `streamedText`.
    await new Promise((r) => setTimeout(r, 100));
    return { chat, conversationId };
  }

  it('persists what streamed when the idle handler wins the race', async () => {
    const { chat } = await streamThenReturn('The morning sun rose over the quiet hills. '.repeat(4));
    await service.cancelTurn(chat.id);
    await new Promise((r) => setTimeout(r, 50));

    const assistant = messages.all.filter((m) => m.chatId === chat.id && m.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.content).toContain('The morning sun rose over the quiet hills.');
    expect(assistant[0]!.metadata?.partial).toBe(true);
  });

  it('persists it just as well when abort does NOT emit idle', async () => {
    harness.idleOnAbort = false;
    const { chat } = await streamThenReturn('Partial answer that must survive. ');
    await service.cancelTurn(chat.id);
    await new Promise((r) => setTimeout(r, 50));

    const assistant = messages.all.filter((m) => m.chatId === chat.id && m.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.content).toContain('Partial answer that must survive.');
  });

  it('writes nothing when the turn was cancelled before the model said anything', async () => {
    const chat = await service.createChat({ name: 'instant-stop' });
    void service.sendPrompt(chat.id, 'hello').catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    await service.cancelTurn(chat.id);
    await new Promise((r) => setTimeout(r, 50));

    // An empty row would show as a blank assistant bubble.
    expect(messages.all.filter((m) => m.chatId === chat.id && m.role === 'assistant')).toHaveLength(0);
  });

  it('does not leak the cancelled flag onto the NEXT turn', async () => {
    // The flag used to be cleared only by the aborted-sendPrompt catch, so a
    // provider whose abort resolves left it set — and every later turn on the
    // chat would then be written as partial.
    const { chat } = await streamThenReturn('first answer ');
    harness.idleOnAbort = false;
    await service.cancelTurn(chat.id);
    await new Promise((r) => setTimeout(r, 50));

    void service.sendPrompt(chat.id, 'second question').catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    
    const conversationId = harness.lastConversationId();
    harness.simulateConversationEvent(conversationId, {
      kind: 'harness.message_complete',
      data: { content: 'a complete second answer' },
    } as never);
    await new Promise((r) => setTimeout(r, 60));
    harness.simulateConversationEvent(conversationId, { kind: 'harness.idle', data: {} } as never);
    await new Promise((r) => setTimeout(r, 100));

    const assistant = messages.all.filter((m) => m.chatId === chat.id && m.role === 'assistant');
    const second = assistant.at(-1)!;
    expect(second.content).toBe('a complete second answer');
    expect(second.metadata?.partial).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// InterruptedTurnRecoveryService — a server restart mid-turn closes the turn.
//
// Before this service existed, a chat whose turn was streaming when the
// process died had no terminal event and no persisted partial message: the
// client replayed the deltas and waited for an idle that never came. These
// tests drive the service against a real EventBus over an in-memory durable
// store shaped like the composition root's adapter.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, Chat, PersistedEvent } from '@generatorai/shared';
import { EventBus, type ISessionEventStore } from '../src/events/EventBus.js';
import {
  InterruptedTurnRecoveryService,
  INTERRUPTED_BY_RESTART_CODE,
  reconstructText,
} from '../src/services/InterruptedTurnRecoveryService.js';
import type { IChatRepository } from '../src/domain/ports/IChatRepository.js';
import type { IChatMessageRepository } from '../src/domain/ports/IRepositories.js';

function memoryStore(): ISessionEventStore & { rows: Map<string, PersistedEvent[]> } {
  const rows = new Map<string, PersistedEvent[]>();
  let id = 0;
  return {
    rows,
    async append(sessionId, event) {
      const list = rows.get(sessionId) ?? [];
      const seq = list.length + 1;
      id += 1;
      list.push({ id, sessionId, sequenceId: seq, kind: event.kind, data: event.data, timestamp: Date.now() } as PersistedEvent);
      rows.set(sessionId, list);
      return { seq, id };
    },
    async replaySessionEvents(sessionId, afterSeq) {
      return (rows.get(sessionId) ?? []).filter((r) => r.sequenceId > afterSeq);
    },
    async deleteSessionEvents(sessionId) {
      rows.delete(sessionId);
    },
    async lastSeq(sessionId) {
      return rows.get(sessionId)?.length ?? 0;
    },
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function build(chats: Chat[]) {
  const store = memoryStore();
  const eventBus = new EventBus();
  eventBus.setEventStore(store);
  const created: unknown[] = [];
  const messageRepo = { create: vi.fn(async (m: unknown) => { created.push(m); return m; }) } as unknown as IChatMessageRepository;
  const chatRepo = { getByStatus: vi.fn(async () => chats) } as unknown as IChatRepository;
  const service = new InterruptedTurnRecoveryService(chatRepo, messageRepo, eventBus, logger);
  return { store, eventBus, service, created, messageRepo };
}

const chat = (id: string): Chat => ({ id, sessionId: `${id}-session`, name: id, status: 'active', tags: [] } as unknown as Chat);
const ev = (kind: string, data: Record<string, unknown> = {}): AgentEvent => ({ kind, data } as unknown as AgentEvent);

describe('InterruptedTurnRecoveryService', () => {
  it('persists the streamed partial text and emits error + idle for a turn with no terminal event', async () => {
    const c = chat('chat-a');
    const h = build([c]);
    await h.eventBus.emit(c.sessionId, ev('harness.user_message', { content: 'hello' }));
    await h.eventBus.emit(c.sessionId, ev('harness.turn_start', { turnId: 't-1' }));
    await h.eventBus.emit(c.sessionId, ev('harness.token', { text: 'The answer ' }));
    await h.eventBus.emit(c.sessionId, ev('harness.token', { text: 'is forty-' }));
    // ...process dies here.

    const summary = await h.service.recover();

    expect(summary).toMatchObject({ scanned: 1, interrupted: 1, persistedPartials: 1, failures: [] });
    expect(h.messageRepo.create).toHaveBeenCalledTimes(1);
    const msg = h.created[0] as { role: string; content: string; chatId: string; metadata: Record<string, unknown> };
    expect(msg.role).toBe('assistant');
    expect(msg.chatId).toBe('chat-a');
    expect(msg.content).toBe('The answer is forty-');
    expect(msg.metadata).toMatchObject({ partial: true, interrupted: 'server_restart', turnId: 't-1' });

    const tail = h.store.rows.get(c.sessionId)!.slice(-2).map((r) => r.kind);
    expect(tail).toEqual(['harness.error', 'harness.idle']);
    const error = h.store.rows.get(c.sessionId)!.at(-2)!.data as { code: string };
    expect(error.code).toBe(INTERRUPTED_BY_RESTART_CODE);
  });

  it('leaves a turn that finished normally alone', async () => {
    const c = chat('chat-b');
    const h = build([c]);
    await h.eventBus.emit(c.sessionId, ev('harness.turn_start', { turnId: 't-1' }));
    await h.eventBus.emit(c.sessionId, ev('harness.token', { text: 'done' }));
    await h.eventBus.emit(c.sessionId, ev('harness.message_complete', { content: 'done' }));
    await h.eventBus.emit(c.sessionId, ev('harness.idle', {}));
    const before = h.store.rows.get(c.sessionId)!.length;

    const summary = await h.service.recover();

    expect(summary.interrupted).toBe(0);
    expect(h.messageRepo.create).not.toHaveBeenCalled();
    expect(h.store.rows.get(c.sessionId)!.length).toBe(before);
  });

  it('a cancelled turn is terminal too', async () => {
    const c = chat('chat-c');
    const h = build([c]);
    await h.eventBus.emit(c.sessionId, ev('harness.turn_start', { turnId: 't-1' }));
    await h.eventBus.emit(c.sessionId, ev('harness.token', { text: 'half' }));
    await h.eventBus.emit(c.sessionId, ev('harness.cancelled', {}));

    const summary = await h.service.recover();
    expect(summary.interrupted).toBe(0);
  });

  it('closes a turn that had produced no output yet without inventing a message', async () => {
    const c = chat('chat-d');
    const h = build([c]);
    await h.eventBus.emit(c.sessionId, ev('harness.user_message', { content: 'hi' }));
    await h.eventBus.emit(c.sessionId, ev('harness.turn_start', { turnId: 't-9' }));

    const summary = await h.service.recover();

    expect(summary).toMatchObject({ interrupted: 1, persistedPartials: 0 });
    expect(h.messageRepo.create).not.toHaveBeenCalled();
    expect(h.store.rows.get(c.sessionId)!.slice(-2).map((r) => r.kind)).toEqual(['harness.error', 'harness.idle']);
  });

  it('a chat with no events, and a chat whose newest rows are not turn activity, are skipped', async () => {
    const empty = chat('chat-e');
    const renamed = chat('chat-f');
    const h = build([empty, renamed]);
    await h.eventBus.emit(renamed.sessionId, ev('chat.renamed', { name: 'x' }));

    const summary = await h.service.recover();
    expect(summary).toMatchObject({ scanned: 2, interrupted: 0 });
  });

  it('one failing chat does not stop the others', async () => {
    const bad = chat('chat-bad');
    const good = chat('chat-good');
    const h = build([bad, good]);
    await h.eventBus.emit(good.sessionId, ev('harness.turn_start', { turnId: 't' }));
    await h.eventBus.emit(good.sessionId, ev('harness.token', { text: 'ok' }));
    const realLast = h.store.lastSeq!.bind(h.store);
    h.store.lastSeq = async (sessionId: string) => {
      if (sessionId === bad.sessionId) throw new Error('boom');
      return realLast(sessionId);
    };

    const summary = await h.service.recover();
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toContain('chat-bad');
    expect(summary.interrupted).toBe(1);
  });
});

describe('reconstructText', () => {
  const p = (kind: string, data: Record<string, unknown>): PersistedEvent => ({ kind, data } as unknown as PersistedEvent);

  it('completed segments supersede the tokens that built them; trailing tokens are the partial paragraph', () => {
    const text = reconstructText([
      p('harness.token', { text: 'First ' }),
      p('harness.token', { text: 'para.' }),
      p('harness.message_complete', { content: 'First para.' }),
      p('harness.tool_start', { name: 'Read' }),
      p('harness.token', { text: 'Second par' }),
    ]);
    expect(text).toBe('First para.\n\nSecond par');
  });

  it('ignores whitespace-only completions and returns an empty string for a silent turn', () => {
    expect(reconstructText([p('harness.message_complete', { content: '   ' })])).toBe('');
    expect(reconstructText([p('harness.tool_start', {})])).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────
// Chat list v2 (G-02) — the write side of the list row's summary.
//
//   ChatManagementService   a turn starting is activity; a turn ending
//                           records succeeded / failed / cancelled by
//                           whichever finalisation route wins; each write
//                           announces `chat.updated`; a delete announces
//                           `chat.deleted` on the global path.
//   ChatChangeStatsService  coalesces triggers per workspace, writes the same
//                           stats to every chat on it, and announces only a
//                           real change.
//   ChatListService         cursors are bound to their sort; row summaries
//                           prefer the live agent over the frozen snapshot.
//
// The SQL side (paging, filters, migration) is tested against a real
// database in packages/db/__tests__/ChatListRepository.test.ts, and the whole
// path with a real change summary over a dummy git repo in
// apps/server/src/__tests__/chatList.test.ts.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent, AgentEvent, AttentionSnapshot, Chat, ChatMessage, PersistedEvent, Session } from '@generatorai/shared';
import { emptyAttentionCounts, ValidationError } from '@generatorai/shared';

import { ChatManagementService } from '../src/services/ChatManagementService.js';
import { ChatChangeStatsService, netChangeStats } from '../src/services/ChatChangeStatsService.js';
import { ChatListService, decodeChatListCursor, encodeChatListCursor } from '../src/services/ChatListService.js';
import { EventBus } from '../src/events/EventBus.js';
import type { ISessionRepository, IChatMessageRepository } from '../src/domain/ports/IRepositories.js';
import { MockChatRepository } from './MockRepositories.js';
import { MockCopilotPort } from './MockAgentHarness.js';

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
      const next = { ...store.get(id)!, ...u };
      store.set(id, next);
      return next;
    }),
    updateStatus: vi.fn(async () => {}),
    delete: vi.fn(async (id: string) => { store.delete(id); }),
  };
}

function messageRepoStub(): IChatMessageRepository {
  const all: ChatMessage[] = [];
  return {
    create: vi.fn(async (m: ChatMessage) => { all.push({ ...m }); return { ...m }; }),
    getBySessionId: vi.fn(async (sid: string) => all.filter((m) => m.sessionId === sid)),
    getByChatId: vi.fn(async (cid: string) => all.filter((m) => m.chatId === cid)),
    deleteBySession: vi.fn(async () => {}),
  } as unknown as IChatMessageRepository;
}

/** A provider whose prompt stays in flight until the test ends the turn. */
class ManualHarness extends MockCopilotPort {
  private release: (() => void) | null = null;
  failNextSend: Error | null = null;
  lastConversationId(): string {
    const made = this.calls.filter((c) => c.method === 'createConversation');
    return (made.at(-1)!.args[0] as { conversationId: string }).conversationId;
  }
  override async sendPrompt(conversationId: string, prompt: string): Promise<void> {
    this.calls.push({ method: 'sendPrompt', args: [conversationId, prompt] });
    if (this.failNextSend) {
      const err = this.failNextSend;
      this.failNextSend = null;
      throw err;
    }
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  override async abortConversation(conversationId: string): Promise<void> {
    await super.abortConversation(conversationId);
    this.release?.();
    this.release = null;
  }
  finish(conversationId: string, events: AgentEvent[]): void {
    for (const event of events) this.simulateConversationEvent(conversationId, event);
    this.release?.();
    this.release = null;
  }
}

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

describe('ChatManagementService — list summary columns', () => {
  let chats: MockChatRepository;
  let harness: ManualHarness;
  let bus: EventBus;
  let service: ChatManagementService;
  let emitted: PersistedEvent[];
  let global: PersistedEvent[];

  beforeEach(() => {
    chats = new MockChatRepository();
    harness = new ManualHarness();
    bus = new EventBus();
    emitted = [];
    global = [];
    bus.subscribeAll((e) => emitted.push(e));
    bus.subscribeGlobal((e) => global.push(e));
    service = new ChatManagementService(chats, sessionRepoStub(), messageRepoStub(), harness, bus);
  });

  const updates = (chatId: string) =>
    emitted.filter((e) => e.kind === 'chat.updated' && (e.data as { chatId: string }).chatId === chatId).length;

  async function startTurn(name: string) {
    const chat = await service.createChat({ name });
    const sent = service.sendPrompt(chat.id, 'go').catch((err: unknown) => err);
    await tick(200);
    return { chat, sent, conversationId: harness.lastConversationId() };
  }

  it('moves the activity time when a turn starts and records a succeeded turn at idle', async () => {
    const { chat, conversationId } = await startTurn('ok');
    const started = (await chats.getListActivity(chat.id))!.lastActivityAt;
    expect(started.getTime()).toBeGreaterThan(chat.createdAt.getTime() - 1);
    expect(updates(chat.id)).toBe(1);

    harness.finish(conversationId, [
      { kind: 'harness.message_complete', data: { content: 'done' } } as AgentEvent,
      { kind: 'harness.idle', data: {} } as AgentEvent,
    ]);
    await tick();
    const activity = (await chats.getListActivity(chat.id))!;
    expect(activity.lastTurn?.status).toBe('succeeded');
    expect(activity.lastTurn?.error).toBeUndefined();
    expect(activity.lastActivityAt.getTime()).toBeGreaterThanOrEqual(started.getTime());
    expect(updates(chat.id)).toBe(2);
  });

  it('records a failed turn with the first provider error, once', async () => {
    const { chat, conversationId } = await startTurn('fails');
    harness.finish(conversationId, [
      { kind: 'harness.error', data: { message: 'Rate limited\nretry in 30s' } } as AgentEvent,
      { kind: 'harness.error', data: { message: 'second error' } } as AgentEvent,
      { kind: 'harness.idle', data: {} } as AgentEvent,
    ]);
    await tick();
    expect((await chats.getListActivity(chat.id))!.lastTurn).toMatchObject({ status: 'failed', error: 'Rate limited' });
    expect(updates(chat.id)).toBe(2);
  });

  it('records a turn whose prompt could not be sent as failed', async () => {
    harness.failNextSend = new Error('provider offline');
    const chat = await service.createChat({ name: 'offline' });
    await expect(service.sendPrompt(chat.id, 'go')).rejects.toThrow('provider offline');
    await tick();
    expect((await chats.getListActivity(chat.id))!.lastTurn).toMatchObject({
      status: 'failed',
      error: 'Failed to send prompt: provider offline',
    });
  });

  it('records a stopped turn as cancelled, whichever route finalises it', async () => {
    const { chat } = await startTurn('stop');
    await service.cancelTurn(chat.id);
    await tick();
    expect((await chats.getListActivity(chat.id))!.lastTurn?.status).toBe('cancelled');
  });

  it('announces a delete on the global path', async () => {
    const chat = await service.createChat({ name: 'bye' });
    await service.deleteChat(chat.id);
    await tick(10);
    expect(global.some((e) => e.kind === 'chat.deleted' && (e.data as { chatId: string }).chatId === chat.id)).toBe(true);
  });
});

describe('ChatChangeStatsService', () => {
  let chats: MockChatRepository;
  let bus: EventBus;
  let emitted: PersistedEvent[];
  let computeStats: ReturnType<typeof vi.fn>;
  let service: ChatChangeStatsService;

  async function chat(id: string, workspaceId?: string): Promise<Chat> {
    return chats.create({
      id,
      name: id,
      sessionId: `s-${id}`,
      tags: [],
      status: 'active',
      ...(workspaceId ? { workspaceId } : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  beforeEach(() => {
    chats = new MockChatRepository();
    bus = new EventBus();
    emitted = [];
    bus.subscribeAll((e) => emitted.push(e));
    computeStats = vi.fn(async () => ({ files: 2, additions: 7, deletions: 1 }));
    service = new ChatChangeStatsService({ eventBus: bus, chats, computeStats, debounceMs: 20 });
    service.start();
  });

  afterEach(() => service.stop());

  const updated = () => emitted.filter((e) => e.kind === 'chat.updated').map((e) => (e.data as { chatId: string }).chatId);

  it('coalesces a burst into one recompute and writes every chat on the workspace', async () => {
    await chat('orchestrator', 'ws-1');
    await chat('worker', 'ws-1');
    await chat('other', 'ws-2');
    for (let i = 0; i < 5; i += 1) {
      await bus.emit('s-orchestrator', { kind: 'workspace.changed', data: { workspaceId: 'ws-1', repoAlias: 'app', changedPaths: [], stats: { files: 1, additions: 1, deletions: 0 } } } as AgentEvent);
    }
    await service.settled();
    expect(computeStats).toHaveBeenCalledTimes(1);
    expect(computeStats).toHaveBeenCalledWith('ws-1');
    expect((await chats.getListActivity('orchestrator'))!.changes).toEqual({ files: 2, additions: 7, deletions: 1 });
    expect((await chats.getListActivity('worker'))!.changes).toEqual({ files: 2, additions: 7, deletions: 1 });
    expect((await chats.getListActivity('other'))!.changes).toBeUndefined();
    expect(updated().sort()).toEqual(['orchestrator', 'worker']);
  });

  it('recomputes at turn end, from a global discard, and via ensure() once per workspace', async () => {
    await chat('c1', 'ws-1');
    await bus.emit('s-c1', { kind: 'harness.idle', data: { chatId: 'c1' } } as AgentEvent);
    await tick(5);
    await service.settled();
    expect(computeStats).toHaveBeenCalledTimes(1);

    computeStats.mockResolvedValueOnce({ files: 0, additions: 0, deletions: 0 });
    await bus.emitGlobal({ kind: 'checkpoint.restored', data: { workspaceId: 'ws-1' } } as unknown as AgentEvent);
    await service.settled();
    expect((await chats.getListActivity('c1'))!.changes).toEqual({ files: 0, additions: 0, deletions: 0 });

    service.ensure([{ workspaceId: 'ws-9' }, { workspaceId: 'ws-9' }, {}]);
    service.ensure([{ workspaceId: 'ws-9' }]);
    await service.settled();
    expect(computeStats.mock.calls.filter(([ws]) => ws === 'ws-9')).toHaveLength(1);
  });

  it('P2-R9: runs at most maxConcurrent summaries at once across workspaces, and every one still runs', async () => {
    service.stop();
    let inFlight = 0;
    let peak = 0;
    const done: string[] = [];
    computeStats = vi.fn(async (ws: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick(5);
      inFlight -= 1;
      done.push(ws);
      return { files: 1, additions: 1, deletions: 0 };
    });
    service = new ChatChangeStatsService({ eventBus: bus, chats, computeStats, debounceMs: 5, maxConcurrent: 3 });
    service.start();
    // A listed page of 40 never-computed rows on 40 workspaces.
    service.ensure(Array.from({ length: 40 }, (_, i) => ({ workspaceId: `ws-${i}` })));
    await service.settled();
    expect(done).toHaveLength(40);
    expect(peak).toBe(3);
  });

  it('announces only a real change, and leaves the column unknown when the workspace is gone', async () => {
    await chat('c1', 'ws-1');
    service.ensure([{ workspaceId: 'ws-1' }]);
    await service.settled();
    await bus.emit('s-c1', { kind: 'workspace.changed', data: { workspaceId: 'ws-1' } } as unknown as AgentEvent);
    await service.settled();
    expect(updated()).toEqual(['c1']);

    await chat('c2', 'ws-gone');
    computeStats.mockResolvedValueOnce(null);
    service.ensure([{ workspaceId: 'ws-gone' }]);
    await service.settled();
    expect((await chats.getListActivity('c2'))!.changes).toBeUndefined();
  });

  it('counts a legacy workspace root only when no codebase is mounted', () => {
    const root = { kind: 'root', stats: { files: 3, additions: 30, deletions: 0 } };
    const mount = { kind: 'mount', stats: { files: 1, additions: 2, deletions: 3 } };
    expect(netChangeStats([root, mount])).toEqual({ files: 1, additions: 2, deletions: 3 });
    expect(netChangeStats([root])).toEqual({ files: 3, additions: 30, deletions: 0 });
    expect(netChangeStats([])).toEqual({ files: 0, additions: 0, deletions: 0 });
    // A repo the engine failed on reports placeholder zeros without a base tree.
    expect(netChangeStats([{ ...mount, base: { treeish: 'abc' } }])).toEqual(mount.stats);
    expect(netChangeStats([{ kind: 'mount', stats: { files: 0, additions: 0, deletions: 0 }, base: {} }])).toBeNull();
  });
});

describe('ChatListService', () => {
  const empty: AttentionSnapshot = { seq: 1, generatedAt: '', needsYou: [], running: [], counts: emptyAttentionCounts() };

  it('binds a cursor to its sort and refuses anything else', () => {
    const cursor = encodeChatListCursor('name', { value: 'alpha', id: 'c1' });
    expect(decodeChatListCursor(cursor, 'name')).toEqual({ value: 'alpha', id: 'c1' });
    expect(() => decodeChatListCursor(cursor, 'activity')).toThrow(ValidationError);
    expect(() => decodeChatListCursor('not-a-cursor', 'name')).toThrow(ValidationError);
    // The value's type must fit the sort it claims (P2-R20).
    const forged = (s: string, v: unknown) => Buffer.from(JSON.stringify({ s, v, i: 'c1' })).toString('base64url');
    expect(() => decodeChatListCursor(forged('activity', 'alpha'), 'activity')).toThrow(ValidationError);
    expect(() => decodeChatListCursor(forged('name', 42), 'name')).toThrow(ValidationError);
    expect(decodeChatListCursor(forged('created', 42), 'created')).toEqual({ value: 42, id: 'c1' });
  });

  it('builds row summaries: live agent over the frozen snapshot, preview, counts, next cursor', async () => {
    const createdAt = new Date('2026-09-26T09:00:00.000Z');
    const base = { sessionId: 's', tags: [], status: 'active' as const, createdAt, updatedAt: createdAt };
    const listPage = vi.fn(async () => ({
      rows: [
        {
          chat: { ...base, id: 'a', name: 'A', sessionId: 's-a', agentRef: 'global:reviewer', workspaceId: 'ws-a', agentSnapshot: { driving: { ref: 'global:reviewer', name: 'Old name', role: 'agent' } } } as unknown as Chat,
          activity: { lastActivityAt: new Date('2026-09-26T10:00:00.000Z'), lastTurn: { status: 'failed' as const, endedAt: new Date('2026-09-26T10:00:00.000Z'), error: 'boom' } },
        },
        {
          chat: { ...base, id: 'b', name: 'B', sessionId: 's-b', agentRef: 'global:gone', agentSnapshot: { driving: { ref: 'global:gone', name: 'Gone agent', role: 'orchestrator' } } } as unknown as Chat,
          activity: { lastActivityAt: createdAt, changes: { files: 1, additions: 2, deletions: 0 } },
        },
      ],
      next: { value: 123, id: 'b' },
      total: 9,
      counts: { active: 7, archived: 2 },
    }));
    const ensure = vi.fn();
    const service = new ChatListService({
      chats: { listPage },
      attention: { getSnapshot: () => empty },
      messages: {
        latestBySessionIds: async () =>
          new Map([['s-a', { id: 'm', sessionId: 's-a', role: 'assistant', content: 'Here is ```ts\ncode\n``` done', timestamp: createdAt } as ChatMessage]]),
      },
      agents: {
        getByRef: async (ref: string) => (ref === 'global:reviewer' ? ({ ref, name: 'Reviewer', role: 'agent' } as Agent) : null),
      },
      changeStats: { ensure },
    });

    const page = await service.list({ sort: 'activity', limit: 2, workers: false });
    expect(page.total).toBe(9);
    expect(page.counts).toEqual({ all: 9, active: 7, archived: 2 });
    expect(decodeChatListCursor(page.nextCursor!, 'activity')).toEqual({ value: 123, id: 'b' });
    expect(page.items[0]!.summary).toEqual({
      lastActivityAt: '2026-09-26T10:00:00.000Z',
      lastTurn: { status: 'failed', endedAt: '2026-09-26T10:00:00.000Z', error: 'boom' },
      agent: { ref: 'global:reviewer', name: 'Reviewer', role: 'agent' },
      preview: { text: 'Here is [code] done', role: 'assistant', at: '2026-09-26T09:00:00.000Z' },
    });
    expect(page.items[1]!.summary).toEqual({
      lastActivityAt: '2026-09-26T09:00:00.000Z',
      changes: { files: 1, additions: 2, deletions: 0 },
      agent: { ref: 'global:gone', name: 'Gone agent', role: 'orchestrator' },
    });
    // Row `a` has a workspace and no stats yet: filled in lazily.
    expect(ensure).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })]);
    expect(listPage).toHaveBeenCalledWith({ filter: { includeWorkers: false }, sort: 'activity', limit: 2 });
  });

  it('resolves live states from the attention feed, with worker roll-up', async () => {
    const listPage = vi.fn(async () => ({ rows: [], next: null, total: 0, counts: { active: 0, archived: 0 } }));
    const snapshot: AttentionSnapshot = {
      ...empty,
      needsYou: [
        { key: 'chat:w:i', entity: 'chat', entityId: 'w', title: 'w', href: '', state: 'needs_you', since: '', stoppable: false, parent: { entity: 'chat', id: 'orch', title: 'o' }, ask: { kind: 'question', id: 'i', summary: '?', actions: ['answer'] } },
      ],
      running: [
        { key: 'chat:r', entity: 'chat', entityId: 'r', title: 'r', href: '', state: 'running', since: '', stoppable: true },
        { key: 'workflow_run:x', entity: 'workflow_run', entityId: 'x', title: 'x', href: '', state: 'running', since: '', stoppable: true },
      ],
    };
    const service = new ChatListService({ chats: { listPage }, attention: { getSnapshot: () => snapshot } });
    await service.list({ sort: 'activity', limit: 50, workers: false, states: ['needs_you', 'done'] });
    expect(listPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          state: { ids: ['w', 'orch'], turnStatuses: ['succeeded'], excludeIds: ['w', 'orch', 'r'] },
        }),
      }),
    );
    await service.list({ sort: 'activity', limit: 50, workers: false, states: ['running'] });
    expect(listPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ filter: expect.objectContaining({ state: { ids: ['r'], turnStatuses: [], excludeIds: [] } }) }),
    );
  });
});

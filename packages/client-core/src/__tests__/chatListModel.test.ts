// ────────────────────────────────────────────────────────────────
// Chat list read model (G-02): row status, stream invalidation, cache keys,
// page merging — plus the wire calls of `createApiClient().chats`.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import type { AttentionItem, AttentionSnapshot, ChatListPage } from '@generatorai/shared';
import { CHAT_BULK_MAX_IDS, emptyAttentionCounts, runChatBulk } from '@generatorai/shared';
import {
  chatListInvalidatedBy,
  chatListKey,
  chatListStreamFilter,
  chatLiveSets,
  chatRowState,
  chatRowStatus,
  mergeChatListPages,
} from '../chats/index.js';
import { createApiClient } from '../api/client.js';

const item = (entityId: string, over: Partial<AttentionItem> = {}): AttentionItem => ({
  key: `chat:${entityId}`,
  entity: 'chat',
  entityId,
  title: entityId,
  href: `/chats/${entityId}`,
  state: 'running',
  since: '2026-09-26T10:00:00.000Z',
  stoppable: true,
  ...over,
});

const snapshot = (needsYou: AttentionItem[], running: AttentionItem[]): AttentionSnapshot => ({
  seq: 1,
  generatedAt: '2026-09-26T10:00:00.000Z',
  needsYou,
  running,
  counts: emptyAttentionCounts(),
});

const row = (id: string, status: 'active' | 'archived' = 'active', lastTurn?: 'succeeded' | 'failed' | 'cancelled') => ({
  id,
  status,
  summary: lastTurn ? { lastTurn: { status: lastTurn, endedAt: '2026-09-26T10:00:00.000Z' } } : {},
});

describe('chatRowState', () => {
  const live = chatLiveSets(
    snapshot(
      [
        item('asking', { ask: { kind: 'question', id: 'q1', summary: 'Which?', actions: ['answer'] } }),
        // A worker's ask counts for its orchestrator, which is the list row.
        item('worker', {
          parent: { entity: 'chat', id: 'orchestrator', title: 'Orchestrator' },
          ask: { kind: 'tool_permission', id: 'p1', summary: 'Allow?', actions: ['allow_once', 'deny'] },
        }),
      ],
      [item('streaming'), item('asking')],
    ),
  );

  it('prefers archived, then Needs you, then Running, then the last turn', () => {
    expect(chatRowState(row('asking', 'archived'), live)).toBe('archived');
    expect(chatRowState(row('asking', 'active', 'succeeded'), live)).toBe('needs_you');
    expect(chatRowState(row('orchestrator'), live)).toBe('needs_you');
    expect(chatRowState(row('streaming', 'active', 'failed'), live)).toBe('running');
    expect(chatRowState(row('quiet', 'active', 'succeeded'), live)).toBe('done');
    expect(chatRowState(row('quiet', 'active', 'failed'), live)).toBe('failed');
    expect(chatRowState(row('quiet', 'active', 'cancelled'), live)).toBe('cancelled');
    expect(chatRowState(row('fresh'), live)).toBe('idle');
  });

  it('shows the last outcome, not "idle", while the attention feed is unknown', () => {
    expect(chatLiveSets(undefined)).toBeNull();
    expect(chatRowState(row('streaming', 'active', 'failed'), null)).toBe('failed');
  });

  it('maps to the D-18 visual states', () => {
    expect(chatRowStatus('needs_you')).toEqual({ state: 'needs_you' });
    expect(chatRowStatus('running')).toEqual({ state: 'running' });
    expect(chatRowStatus('done')).toEqual({ state: 'succeeded' });
    expect(chatRowStatus('failed')).toEqual({ state: 'failed' });
    expect(chatRowStatus('cancelled')).toEqual({ state: 'skipped', label: 'Cancelled' });
    expect(chatRowStatus('archived')).toBeNull();
    expect(chatRowStatus('idle')).toBeNull();
  });
});

describe('stream invalidation', () => {
  it('refetches on chat lifecycle kinds, and on attention only for a live-state filter', () => {
    for (const kind of ['chat.created', 'chat.updated', 'chat.archived', 'chat.deleted']) {
      expect(chatListInvalidatedBy(kind, {})).toBe(true);
    }
    expect(chatListInvalidatedBy('chat.mode_changed', {})).toBe(false);
    expect(chatListInvalidatedBy('attention.upsert', {})).toBe(false);
    expect(chatListInvalidatedBy('attention.upsert', { state: 'done' })).toBe(false);
    expect(chatListInvalidatedBy('attention.upsert', { state: ['done', 'running'] })).toBe(true);
    expect(chatListInvalidatedBy('attention.counts', { state: 'needs_you' })).toBe(false);
    expect(chatListStreamFilter({})).toEqual(['chat.created', 'chat.updated', 'chat.archived', 'chat.deleted']);
    expect(chatListStreamFilter({ state: 'needs_you' })).toContain('attention.remove');
  });
});

describe('chatListKey', () => {
  it('is the same for the same query however it is spelled', () => {
    expect(chatListKey({ tag: ['b', 'a'], projectId: 'p', q: ' x ' })).toEqual(
      chatListKey({ tag: ['a', 'b'], projectId: ['p'], q: 'x', sort: 'activity', workers: false }),
    );
    expect(chatListKey({ sort: 'name' })).not.toEqual(chatListKey({}));
  });
});

describe('mergeChatListPages', () => {
  const page = (ids: string[], nextCursor: string | null, total: number): ChatListPage<{ id: string }> => ({
    items: ids.map((id) => ({ id })),
    nextCursor,
    total,
    counts: { all: total, active: total, archived: 0 },
  });

  it('concatenates in order, keeps the first copy of a moved row, and takes totals from the newest page', () => {
    const merged = mergeChatListPages([page(['a', 'b'], 'c1', 5), page(['b', 'c'], null, 6)]);
    expect(merged).toEqual({
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      nextCursor: null,
      total: 6,
      counts: { all: 6, active: 6, archived: 0 },
    });
    expect(mergeChatListPages([])).toBeNull();
  });
});

describe('createApiClient().chats', () => {
  function capture() {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      const body = url.includes('/archive') || url.includes('/delete')
        ? { succeeded: ['a'], failed: [] }
        : { items: [], nextCursor: null, total: 0, counts: { all: 0, active: 0, archived: 0 } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { calls, api: createApiClient(fetchImpl) };
  }

  it('sends the whole query, repeating multi-valued filters', async () => {
    const { calls, api } = capture();
    const page = await api.chats.list({
      status: 'archived',
      projectId: ['p1', 'p2'],
      tag: 'needs review',
      state: ['done'],
      q: ' 50% ',
      sort: 'name',
      cursor: 'abc',
      limit: 10,
      workers: true,
    });
    expect(page.items).toEqual([]);
    expect(calls[0]!.url).toBe(
      '/api/chats?status=archived&projectId=p1&projectId=p2&tag=needs%20review&state=done&q=50%25&sort=name&cursor=abc&limit=10&workers=true',
    );
  });

  it('asks for the default page with no query string', async () => {
    const { calls, api } = capture();
    await api.chats.list();
    expect(calls[0]!.url).toBe('/api/chats');
  });

  it('bulk archive and delete are one POST each', async () => {
    const { calls, api } = capture();
    await api.chats.archiveMany(['a']);
    await api.chats.removeMany(['a', 'b']);
    expect(calls.map((c) => [c.url, c.init?.method, c.init?.body])).toEqual([
      ['/api/chats/archive', 'POST', JSON.stringify({ ids: ['a'] })],
      ['/api/chats/delete', 'POST', JSON.stringify({ ids: ['a', 'b'] })],
    ]);
  });

  it('P2-R1: splits more than CHAT_BULK_MAX_IDS into capped requests and merges the per-id results', async () => {
    const bodies: string[][] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
      bodies.push(ids);
      const failed = ids.filter((id) => id === 'c-7' || id === 'c-420');
      return new Response(
        JSON.stringify({
          succeeded: ids.filter((id) => !failed.includes(id)),
          failed: failed.map((id) => ({ id, code: 'NOT_FOUND', message: 'gone' })),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const api = createApiClient(fetchImpl);
    const ids = Array.from({ length: 450 }, (_, i) => `c-${i}`);
    const result = await api.chats.removeMany([...ids, 'c-3']); // a duplicate is sent once
    expect(bodies.map((b) => b.length)).toEqual([CHAT_BULK_MAX_IDS, CHAT_BULK_MAX_IDS, 50]);
    expect(result.succeeded).toHaveLength(448);
    expect(result.failed.map((f) => f.id)).toEqual(['c-7', 'c-420']);
  });
});

describe('runChatBulk (shared bulk contract)', () => {
  it('throws the first error when nothing succeeded, else reports the rest as failed', async () => {
    const boom = Object.assign(new Error('offline'), { code: 'NETWORK' });
    await expect(runChatBulk(['a', 'b'], async () => Promise.reject(boom), 1)).rejects.toBe(boom);

    let call = 0;
    const result = await runChatBulk(
      ['a', 'b', 'c'],
      async (batch) => {
        call += 1;
        if (call === 2) throw boom;
        return { succeeded: batch, failed: [] };
      },
      1,
    );
    expect(result).toEqual({
      succeeded: ['a'],
      failed: [
        { id: 'b', code: 'NETWORK', message: 'offline' },
        { id: 'c', code: 'NETWORK', message: 'offline' },
      ],
    });
  });
});

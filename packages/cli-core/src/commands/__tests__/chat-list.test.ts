// P2-R26 (`chat list` says when it stopped at one page) and P2-R9 (a chat ref
// is resolved with the server's `q=` search or one GET, not by paging every
// chat — which also scheduled a "Changes ±" backfill per row).
import { describe, expect, it, vi } from 'vitest';
import { chatCommands } from '../chat.js';
import type { CliContext } from '../../context/CliContext.js';
import { CliError } from '../../errors/CliError.js';

const row = (id: string, name = id) => ({ id, name, status: 'active', createdAt: 0, updatedAt: 0 });

function page(ids: string[], nextCursor: string | null, total: number) {
  return { items: ids.map((id) => row(id)), nextCursor, total, counts: { all: total, active: total, archived: 0 } };
}

const listCmd = chatCommands().find((c) => c.id === 'chat.list')!;
const updateCmd = chatCommands().find((c) => c.id === 'chat.update')!;

describe('chat list', () => {
  it('prints one page and says how to get the rest', async () => {
    const list = vi.fn(async () => page(['a', 'b'], 'CUR', 312));
    const ctx = { api: { chats: { list } } } as unknown as CliContext;
    const result = await listCmd.handler(ctx, { args: {}, flags: { status: 'active' } } as never);
    expect(result.data).toHaveLength(2);
    expect(result.warnings).toEqual([
      'Showing 2 of 312 chats. Next page: --cursor CUR  (or --all for every page)',
    ]);

    await listCmd.handler(ctx, { args: {}, flags: { status: 'active', cursor: 'CUR' } } as never);
    expect(list).toHaveBeenLastCalledWith({ status: 'active', cursor: 'CUR' });
  });

  it('--all follows every cursor', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(page(['a', 'b'], 'c1', 3))
      .mockResolvedValueOnce(page(['c'], null, 3));
    const ctx = { api: { chats: { list } } } as unknown as CliContext;
    const result = await listCmd.handler(ctx, { args: {}, flags: { status: 'all', all: true } } as never);
    expect((result.data as Array<{ id: string }>).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(result.warnings).toBeUndefined();
    expect(list).toHaveBeenNthCalledWith(2, { limit: 200, cursor: 'c1' });
  });
});

describe('chat ref resolution', () => {
  it('resolves an exact id with one GET and a name with the q= search', async () => {
    const update = vi.fn(async () => row('chat_1'));
    const get = vi.fn(async (id: string) => {
      if (id === 'chat_1') return row('chat_1', 'Auth refactor');
      throw new Error('404');
    });
    const list = vi.fn(async (q: { q?: string }) => ({
      ...page([], null, 0),
      items: q.q === 'Auth refactor' ? [row('chat_1', 'Auth refactor')] : [],
    }));
    const ctx = { api: { chats: { list, get, update } } } as unknown as CliContext;

    await updateCmd.handler(ctx, { args: { chat: 'chat_1' }, flags: { name: 'x' } } as never);
    expect(get).toHaveBeenCalledWith('chat_1');
    expect(list).not.toHaveBeenCalled();

    await updateCmd.handler(ctx, { args: { chat: 'Auth refactor' }, flags: { name: 'y' } } as never);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ workers: true, q: 'Auth refactor', limit: 200 });
    expect(update).toHaveBeenLastCalledWith('chat_1', { name: 'y' });
  });
});

// P2-R35 — what the server's `q=` misses, and refs past the first page.
describe('chat ref resolution beyond q= and the first page', () => {
  interface FakeChat {
    id: string;
    name: string;
    status: string;
    createdAt: number;
    updatedAt: number;
  }

  /**
   * A server with `chats` in activity order (index 0 newest). `q=` folds
   * only ASCII case, like SQLite `lower()`; `status` filters; pages of
   * `limit` rows with a numeric cursor.
   */
  function fakeServer(chats: FakeChat[]) {
    const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
    const list = vi.fn(async (query: { q?: string; status?: string; cursor?: string; limit?: number }) => {
      let rows = chats;
      if (query.q) rows = rows.filter((c) => asciiLower(c.name).includes(asciiLower(query.q!)));
      if (query.status) rows = rows.filter((c) => c.status === query.status);
      const start = query.cursor ? Number(query.cursor) : 0;
      const limit = query.limit ?? 50;
      const items = rows.slice(start, start + limit);
      const next = start + limit < rows.length ? String(start + limit) : null;
      return { items, nextCursor: next, total: rows.length, counts: { all: rows.length, active: 0, archived: 0 } };
    });
    const get = vi.fn(async () => {
      throw new Error('404');
    });
    const update = vi.fn(async (id: string) => chats.find((c) => c.id === id));
    const ctx = { api: { chats: { list, get, update } } } as unknown as CliContext;
    const rename = (chat: string) =>
      updateCmd.handler(ctx, { args: { chat }, flags: { name: 'renamed' } } as never);
    return { ctx, list, update, rename };
  }

  const many = (count: number, over: (i: number) => Partial<FakeChat> = () => ({})): FakeChat[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `chat-${String(i + 1).padStart(4, '0')}`,
      name: `Chat ${i + 1}`,
      status: 'archived',
      createdAt: 1_000,
      updatedAt: 1_000,
      ...over(i),
    }));

  it('finds a non-ASCII name that q= misses, in any case, by scanning every chat', async () => {
    const chats = many(450, (i) => (i === 420 ? { name: 'Über plan' } : {}));
    const server = fakeServer(chats);

    await server.rename('Über plan');
    expect(server.update).toHaveBeenLastCalledWith('chat-0421', { name: 'renamed' });
    await server.rename('über PLAN');
    expect(server.update).toHaveBeenLastCalledWith('chat-0421', { name: 'renamed' });
    // q= first; then the paged scan (3 pages of 200).
    expect(server.list.mock.calls.slice(-4).map(([q]) => q)).toEqual([
      { workers: true, q: 'über PLAN', limit: 200 },
      { workers: true, limit: 200 },
      { workers: true, limit: 200, cursor: '200' },
      { workers: true, limit: 200, cursor: '400' },
    ]);
  });

  it('does not scan every chat when q= already has the exact name', async () => {
    const server = fakeServer(many(450, (i) => (i === 300 ? { name: 'Deploy plan' } : {})));
    await server.rename('deploy plan');
    expect(server.list).toHaveBeenCalledTimes(1);
    expect(server.update).toHaveBeenLastCalledWith('chat-0301', { name: 'renamed' });
  });

  it('says no chat matches an unknown ref, and "No chats exist yet." only when there are none', async () => {
    const withChats = fakeServer(many(3));
    const miss = await withChats.rename('nothing like it').catch((e: unknown) => e);
    expect(miss).toBeInstanceOf(CliError);
    expect((miss as CliError).message).toBe('No chat matches "nothing like it".');
    expect((miss as CliError).hint).toBeUndefined();

    const empty = await fakeServer([]).rename('anything').catch((e: unknown) => e);
    expect((empty as CliError).hint).toBe('No chats exist yet.');
  });

  it('#n counts past the first page, fetching only the pages it needs', async () => {
    const server = fakeServer(many(650));
    await server.rename('#250');
    expect(server.update).toHaveBeenLastCalledWith('chat-0250', { name: 'renamed' });
    expect(server.list).toHaveBeenCalledTimes(2);

    server.list.mockClear();
    await server.rename('#3');
    expect(server.update).toHaveBeenLastCalledWith('chat-0003', { name: 'renamed' });
    expect(server.list).toHaveBeenCalledTimes(1);

    const tooFar = await server.rename('#700').catch((e: unknown) => e);
    expect((tooFar as CliError).hint).toBe('Only 650 chats are available.');
  });

  it('@last and @active see every chat, not just the newest page', async () => {
    const server = fakeServer(
      many(450, (i) =>
        i === 410 ? { updatedAt: 9_000, status: 'active' } : {},
      ),
    );
    await server.rename('@last');
    expect(server.update).toHaveBeenLastCalledWith('chat-0411', { name: 'renamed' });
    await server.rename('@active');
    expect(server.update).toHaveBeenLastCalledWith('chat-0411', { name: 'renamed' });
    expect(server.list).toHaveBeenLastCalledWith({ workers: true, status: 'active', limit: 200 });

    // No active chat: the @active hint, not "No chats exist yet.".
    const idle = await fakeServer(many(5)).rename('@active').catch((e: unknown) => e);
    expect((idle as CliError).hint).toBe('No chat is currently running or active.');
  });
});

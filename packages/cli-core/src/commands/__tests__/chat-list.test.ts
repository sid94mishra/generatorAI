// P2-R26 (`chat list` says when it stopped at one page) and P2-R9 (a chat ref
// is resolved with the server's `q=` search or one GET, not by paging every
// chat — which also scheduled a "Changes ±" backfill per row).
import { describe, expect, it, vi } from 'vitest';
import { chatCommands } from '../chat.js';
import type { CliContext } from '../../context/CliContext.js';

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

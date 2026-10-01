import { describe, expect, it } from 'vitest';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import { chatListKey } from '@generatorai/client-core';
import { mayPersistQuery, trimPersistedPages } from '../queryPersistencePolicy';

describe('offline cache boundary', () => {
  it('requires success, explicit opt-in, and a known list shape', () => {
    const check = (queryKey: unknown[], persist = true, status = 'success') => mayPersistQuery({ queryKey, meta: { persist }, state: { status } });
    expect(check(['chats', chatListKey()])).toBe(true);
    expect(check(['projects', 'summary'])).toBe(true);
    expect(check(['attention'])).toBe(true);
    expect(check(['attention'], false)).toBe(false);
    expect(check(['attention'], true, 'error')).toBe(false);
    for (const key of [['chats', 'c1', 'messages'], ['chats', 'c1'], ['terminal'], ['browser'], ['projects', 'p1'], ['devices', 'all'], ['workflows', 'detail', 'w1']]) expect(check(key)).toBe(false);
  });
  it('persists only page one without modifying the live infinite query', () => {
    const client = new QueryClient();
    const key = ['chats', chatListKey()];
    const data = { pages: [{ items: ['first'], nextCursor: 'next' }, { items: ['second'] }], pageParams: [undefined, 'next'] };
    client.setQueryData(key, data);
    const persisted = trimPersistedPages({ timestamp: Date.now(), buster: 'test', clientState: dehydrate(client) });
    expect(persisted.clientState.queries[0]?.state.data).toEqual({ pages: [data.pages[0]], pageParams: [undefined] });
    expect(client.getQueryData(key)).toEqual(data);
    expect(persisted.clientState.mutations).toEqual([]);
    client.clear();
  });
});

import type { PersistedClient } from '@tanstack/react-query-persist-client';

export const QUERY_MAX_AGE = 24 * 60 * 60 * 1000;
export const QUERY_SCHEMA_VERSION = 1;

/** Explicit opt-in plus an allowlist; a misplaced meta flag must not persist a transcript. */
export function mayPersistQuery(query: { queryKey: readonly unknown[]; meta?: Record<string, unknown>; state: { status: string } }): boolean {
  if (query.meta?.persist !== true || query.state.status !== 'success') return false;
  const [root, second] = query.queryKey;
  if (root === 'chats') return query.queryKey.length === 2 && typeof second === 'object' && second !== null && 'q' in second && 'sort' in second;
  if (root === 'projects') return query.queryKey.length === 2 && second === 'summary';
  if (root === 'agents') return query.queryKey.length === 2 && (second === 'all' || second === 'selectable');
  if (root === 'system') return second === 'info' && query.queryKey.length === 2;
  if (root === 'devices') return second === 'own' && query.queryKey.length === 2;
  return query.queryKey.length === 1 && ['attention', 'workflows', 'automations', 'workflow-scripts'].includes(String(root));
}

/** The chat list is an infinite query, but only its first page belongs on disk. */
export function trimPersistedPages(client: PersistedClient): PersistedClient {
  return { ...client, clientState: { ...client.clientState, mutations: [], queries: client.clientState.queries.map((query) => {
    const data = query.state.data as { pages?: unknown[]; pageParams?: unknown[] } | undefined;
    if (query.queryKey[0] !== 'chats' || !Array.isArray(data?.pages)) return query;
    return { ...query, state: { ...query.state, data: { ...data, pages: data.pages.slice(0, 1), pageParams: data.pageParams?.slice(0, 1) } } };
  }) } };
}

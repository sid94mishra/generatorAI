// ────────────────────────────────────────────────────────────────
// Chat list read model (G-02) — the source data of a ChatsList row.
//
// `GET /api/chats` answers pages of `ChatListRow` (chat + `summary`). What a
// row still needs from elsewhere is its LIVE state, which lives in the
// attention feed (G-01); `chatRowState` combines the two with the same rule
// the server's `state` filter uses (`liveChatIds` in @generatorai/shared):
//
//   archived                       → archived
//   has an ask (or a worker does)  → needs_you
//   streaming (or a worker is)     → running
//   otherwise the last turn        → done | failed | cancelled
//   never ran                      → idle
//
// Also here: the stream kinds that make a cached list stale, page merging for
// infinite scroll, and a canonical cache key per query — so web (React Query),
// mobile and the CLI page and refresh the list the same way. The row's UI
// contract type (`ChatRowModel`) lands with the ChatsList port (P3-07).
// ────────────────────────────────────────────────────────────────

import {
  STATUS_MAPS,
  liveChatIds,
  type AttentionSnapshot,
  type ChatListCounts,
  type ChatListItem,
  type ChatListPage,
  type ChatListQuery,
  type ChatListState,
  type ChatListSummary,
  type StatusMapping,
} from '@generatorai/shared';
import type { ChatRowModel } from '@generatorai/shared/ui-contract';

/** What a row's Status column says. */
export type ChatRowState = 'needs_you' | 'running' | 'done' | 'failed' | 'cancelled' | 'archived' | 'idle';

/** The live chat ids of an attention snapshot, or null while the feed has not loaded. */
export type ChatLiveSets = ReturnType<typeof liveChatIds>;

export function chatLiveSets(snapshot: Pick<AttentionSnapshot, 'needsYou' | 'running'> | null | undefined): ChatLiveSets | null {
  return snapshot ? liveChatIds(snapshot) : null;
}

/**
 * The Status column of one row. `live` is null while the attention feed is
 * unknown; the row then shows its last outcome, which is real data, rather
 * than claiming it is idle.
 */
export function chatRowState(
  row: { id: string; status: string; summary: Pick<ChatListSummary, 'lastTurn'> },
  live: ChatLiveSets | null,
): ChatRowState {
  if (row.status === 'archived') return 'archived';
  if (live?.needsYou.has(row.id)) return 'needs_you';
  if (live?.running.has(row.id)) return 'running';
  switch (row.summary.lastTurn?.status) {
    case 'succeeded':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'idle';
  }
}

/**
 * The D-18 visual state for a row state. Null for `archived` (a neutral
 * "Archived" chip, like the `chat` domain) and `idle` (no badge).
 */
export function chatRowStatus(state: ChatRowState): StatusMapping | null {
  switch (state) {
    case 'needs_you':
      return { state: 'needs_you' };
    case 'running':
      return STATUS_MAPS.stream.streaming;
    case 'done':
      return STATUS_MAPS.chatTurn.succeeded;
    case 'failed':
      return STATUS_MAPS.chatTurn.failed;
    case 'cancelled':
      return STATUS_MAPS.chatTurn.cancelled;
    default:
      return null;
  }
}

/**
 * The row contract (`ChatRowModel`, M-11) for one `GET /api/chats` item: the
 * Status column resolved from the row plus the live attention sets, and the
 * project name joined in from the caller's own project cache (the list API
 * only carries `projectId`). Pure — web (`features/chats`) and, next pass,
 * mobile call it the same way.
 */
export function toChatRowModel(item: ChatListItem, live: ChatLiveSets | null, projectName?: string): ChatRowModel {
  const state = chatRowState(item, live);
  const mapping = chatRowStatus(state);
  return {
    id: item.id,
    title: item.name,
    projectId: item.projectId,
    projectName,
    agentRef: item.summary.agent?.ref,
    agentName: item.summary.agent?.name,
    status: mapping ? { state: mapping.state, label: mapping.label } : null,
    archived: state === 'archived',
    changes: item.summary.changes,
    lastActivityAt: item.summary.lastActivityAt,
    tags: item.tags,
  };
}

/** Global-scope kinds after which a cached chat list is stale. */
export const CHAT_LIST_EVENT_KINDS: readonly string[] = ['chat.created', 'chat.updated', 'chat.archived', 'chat.deleted'];

/**
 * The `global` stream filter a live list subscribes with. A list filtered by
 * a LIVE state (Needs you / Running) also follows the attention feed, whose
 * changes move rows in and out of it.
 */
export function chatListStreamFilter(query: ChatListQuery = {}): string[] {
  return followsAttention(query) ? [...CHAT_LIST_EVENT_KINDS, 'attention.upsert', 'attention.remove'] : [...CHAT_LIST_EVENT_KINDS];
}

/** Whether an event of `kind` on the `global` scope makes a list for `query` stale. */
export function chatListInvalidatedBy(kind: string, query: ChatListQuery = {}): boolean {
  if (CHAT_LIST_EVENT_KINDS.includes(kind)) return true;
  return (kind === 'attention.upsert' || kind === 'attention.remove') && followsAttention(query);
}

function followsAttention(query: ChatListQuery): boolean {
  const states = toList(query.state);
  return states.includes('needs_you') || states.includes('running');
}

function toList<T extends string>(value: T | readonly T[] | undefined): T[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : [...value];
}

/** A query with defaults applied and lists sorted, for use as a cache key. Excludes the cursor. */
export function chatListKey(query: ChatListQuery = {}): Required<Pick<ChatListQuery, 'sort' | 'workers'>> & {
  status: string | null;
  projectId: string[];
  agentRef: string[];
  tag: string[];
  state: ChatListState[];
  q: string;
  limit: number | null;
} {
  return {
    status: query.status ?? null,
    projectId: toList(query.projectId).sort(),
    agentRef: toList(query.agentRef).sort(),
    tag: toList(query.tag).sort(),
    state: toList(query.state).sort(),
    q: query.q?.trim() ?? '',
    sort: query.sort ?? 'activity',
    limit: query.limit ?? null,
    workers: query.workers ?? false,
  };
}

export interface MergedChatList<T> {
  items: T[];
  /** Cursor of the last page loaded; null when there is nothing more. */
  nextCursor: string | null;
  total: number;
  counts: ChatListCounts;
}

/**
 * Pages loaded one after another, as one list. A row whose activity moved it
 * between two loads can arrive twice; the first (newer) copy wins. Totals and
 * counts come from the newest page.
 */
export function mergeChatListPages<T extends { id: string }>(pages: ReadonlyArray<ChatListPage<T>>): MergedChatList<T> | null {
  const last = pages[pages.length - 1];
  if (!last) return null;
  const seen = new Set<string>();
  const items: T[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return { items, nextCursor: last.nextCursor, total: last.total, counts: last.counts };
}

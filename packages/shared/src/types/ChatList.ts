// ────────────────────────────────────────────────────────────────
// Chat list v2 (G-02, docs/redesign/05-gap-matrix.md §G-02 and §G-14).
//
// `GET /api/chats` answers one page of chats with a per-row `summary` (last
// activity, last turn outcome, the chat's net change stats, the bound agent,
// a one-line preview), the total that matches the filters, and the
// All / Active / Archived segment counts. Paging is keyset-based: the cursor
// is opaque and only valid for the sort it was issued under.
//
// The live half of a row's status (Needs you / Running) is NOT in this
// shape: it comes from the attention feed (G-01). The `state` filter resolves
// it on the server so a filtered page is still correct; a client that draws
// the Status column combines the two with `chatRowState` in
// `@generatorai/client-core`. Both sides decide "live" with `liveChatIds`.
//
// React-free wire types only; web, desktop, CLI and mobile share them.
// ────────────────────────────────────────────────────────────────

import type { AgentRole } from './Agent.js';
import type { AttentionSnapshot } from './Attention.js';
import type { Chat, ChatStatus } from './Chat.js';

/** How a chat's most recent turn ended. */
export type ChatTurnStatus = 'succeeded' | 'failed' | 'cancelled';

export const CHAT_TURN_STATUSES: readonly ChatTurnStatus[] = ['succeeded', 'failed', 'cancelled'];

/** Net change of the chat's workspace: session baseline → working tree. */
export interface ChatChangeStats {
  files: number;
  additions: number;
  deletions: number;
}

export interface ChatLastTurn {
  status: ChatTurnStatus;
  /** ISO timestamp. */
  endedAt: string;
  /** First line of the provider error; only on `failed`. */
  error?: string;
}

export interface ChatListAgent {
  ref: string;
  name: string;
  role?: AgentRole;
}

export interface ChatListPreview {
  /** One line of the newest message (code, images and markup collapsed). */
  text: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** ISO timestamp. */
  at: string;
}

/** Everything a list row needs beyond the chat record itself. */
export interface ChatListSummary {
  /** ISO timestamp of the newest turn start or end (creation time before the first turn). */
  lastActivityAt: string;
  /** Absent until the first turn ends. */
  lastTurn?: ChatLastTurn;
  /** Absent when the chat has no workspace or its stats were not computed yet (render "—"). */
  changes?: ChatChangeStats;
  /** Absent when no agent is bound. */
  agent?: ChatListAgent;
  /** Absent when the chat has no messages. */
  preview?: ChatListPreview;
}

/**
 * One row of `GET /api/chats`. On the wire every `Date` of `Chat` is an ISO
 * string; `conversationSeed` is never sent.
 */
export type ChatListItem = Chat & { summary: ChatListSummary };

/** The `state` filter: the live half (G-01) plus the last turn's outcome. */
export type ChatListState = 'needs_you' | 'running' | 'done' | 'failed';

export const CHAT_LIST_STATES: readonly ChatListState[] = ['needs_you', 'running', 'done', 'failed'];

export type ChatListSort = 'activity' | 'created' | 'name';

export const CHAT_LIST_SORTS: readonly ChatListSort[] = ['activity', 'created', 'name'];

export const CHAT_LIST_DEFAULT_LIMIT = 50;
export const CHAT_LIST_MAX_LIMIT = 200;

/**
 * Query of `GET /api/chats`. Multi-valued filters match ANY of their values;
 * different filters must ALL match.
 */
export interface ChatListQuery {
  /** Lifecycle segment: Active or Archived. Omitted = All. */
  status?: ChatStatus;
  projectId?: string | readonly string[];
  agentRef?: string | readonly string[];
  tag?: string | readonly string[];
  /** `needs_you` / `running` come from the attention feed; `done` / `failed` from the last turn. */
  state?: ChatListState | readonly ChatListState[];
  /** Case-insensitive substring of the name, the description or a tag. */
  q?: string;
  /** Default `activity` (newest first). `created` is newest first, `name` A→Z. */
  sort?: ChatListSort;
  /** `nextCursor` of the previous page, issued for the same query. */
  cursor?: string;
  /** Default 50, at most 200. */
  limit?: number;
  /** Include orchestrator worker chats. Default false. */
  workers?: boolean;
}

/** All / Active / Archived — every filter applied except `status` and the cursor. */
export interface ChatListCounts {
  all: number;
  active: number;
  archived: number;
}

export interface ChatListPage<T = ChatListItem> {
  items: T[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
  /** Rows matching every filter (including `status`), across all pages. */
  total: number;
  counts: ChatListCounts;
}

/** Body of `POST /api/chats/archive` and `POST /api/chats/delete`. */
export interface ChatBulkRequest {
  ids: string[];
}

export const CHAT_BULK_MAX_IDS = 200;

export interface ChatBulkFailure {
  id: string;
  code: string;
  message: string;
}

/** Per-id outcome of a bulk action; the request itself succeeds when some ids fail. */
export interface ChatBulkResult {
  succeeded: string[];
  failed: ChatBulkFailure[];
}

/**
 * The bulk contract for every client (web, mobile, CLI): the SERVER caps one
 * request at `CHAT_BULK_MAX_IDS`, and the CLIENT splits a larger selection
 * into sequential requests of at most that many and merges the per-id
 * results, so "Select all" over any number of loaded rows works the same
 * everywhere (P2-R1). Ids are de-duplicated first.
 *
 * A request that fails outright (network, 5xx, auth) is thrown when nothing
 * has succeeded yet — the caller sees the same error a single request would
 * give. Once some batch has succeeded, the rest of the ids (that batch and
 * every later one) are reported as failed with that error instead, because
 * throwing would hide the chats that WERE archived or deleted.
 */
export async function runChatBulk(
  ids: readonly string[],
  send: (batch: string[]) => Promise<ChatBulkResult>,
  batchSize: number = CHAT_BULK_MAX_IDS,
): Promise<ChatBulkResult> {
  const unique = [...new Set(ids)];
  const merged: ChatBulkResult = { succeeded: [], failed: [] };
  for (let start = 0; start < unique.length; start += batchSize) {
    const batch = unique.slice(start, start + batchSize);
    let result: ChatBulkResult;
    try {
      result = await send(batch);
    } catch (err) {
      if (merged.succeeded.length === 0) throw err;
      const code = (err as { code?: unknown })?.code;
      const message = err instanceof Error ? err.message : String(err);
      for (const id of unique.slice(start)) {
        merged.failed.push({ id, code: typeof code === 'string' ? code : 'REQUEST_FAILED', message });
      }
      return merged;
    }
    merged.succeeded.push(...result.succeeded);
    merged.failed.push(...result.failed);
  }
  return merged;
}

/** Payload of the `chat.updated` lifecycle event (list-visible fields or summary columns moved). */
export interface ChatUpdatedEventData {
  chatId: string;
}

function toList<T extends string>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

/**
 * The query string for `GET /api/chats` (without the leading `?`). Shared by
 * every client so the wire spelling lives in one place. Multi-valued filters
 * repeat their key. Built by hand rather than with `URLSearchParams`, whose
 * React Native polyfill is incomplete.
 */
export function chatListSearchParams(query: ChatListQuery = {}): string {
  const parts: string[] = [];
  const add = (key: string, value: string): void => {
    parts.push(`${key}=${encodeURIComponent(value)}`);
  };
  if (query.status) add('status', query.status);
  for (const id of toList(query.projectId)) add('projectId', id);
  for (const ref of toList(query.agentRef)) add('agentRef', ref);
  for (const tag of toList(query.tag)) add('tag', tag);
  for (const state of toList(query.state)) add('state', state);
  if (query.q && query.q.trim()) add('q', query.q.trim());
  if (query.sort) add('sort', query.sort);
  if (query.cursor) add('cursor', query.cursor);
  if (query.limit !== undefined) add('limit', String(query.limit));
  if (query.workers !== undefined) add('workers', String(query.workers));
  return parts.join('&');
}

/**
 * The chats that are live right now according to an attention snapshot
 * (G-01): an entity with an ask is Needs you only, and a worker chat's state
 * also counts for its orchestrator, since workers are not list rows of their
 * own. The server's `state` filter and every client's Status column use this
 * one rule.
 */
export function liveChatIds(snapshot: Pick<AttentionSnapshot, 'needsYou' | 'running'>): {
  needsYou: Set<string>;
  running: Set<string>;
} {
  const needsYou = new Set<string>();
  const running = new Set<string>();
  for (const item of snapshot.needsYou) {
    if (item.entity !== 'chat') continue;
    needsYou.add(item.entityId);
    if (item.parent) needsYou.add(item.parent.id);
  }
  for (const item of snapshot.running) {
    if (item.entity !== 'chat') continue;
    running.add(item.entityId);
    if (item.parent) running.add(item.parent.id);
  }
  for (const id of needsYou) running.delete(id);
  return { needsYou, running };
}

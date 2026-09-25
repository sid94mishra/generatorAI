// ────────────────────────────────────────────────────────────────
// ChatListService — one page of the chat list, with row summaries (G-02).
//
// docs/redesign/05-gap-matrix.md §G-02 / §G-14. Answers
// `GET /api/chats`: keyset paging over the chats table (sorted by last
// activity, creation or name), the chip filters (project, agent, tags,
// status), a text search, the All / Active / Archived counts, and per row the
// summary a list needs — last activity, last turn outcome, change stats,
// agent and a one-line preview.
//
// The live half of the Status filter (`needs_you`, `running`) is resolved
// against the attention feed (G-01), which is the one place that knows what
// is waiting and what is executing. A worker chat's ask or run counts for its
// orchestrator too, since workers are not list rows of their own. "Done" and
// "Failed" are the last turn's outcome, for chats that are not live again.
//
// Cursors are opaque: base64url JSON of `{ s: sort, v: value, i: id }`. They
// are only valid for the sort they were issued under.
// ────────────────────────────────────────────────────────────────

import {
  ValidationError,
  liveChatIds,
  type Agent,
  type AttentionSnapshot,
  type Chat,
  type ChatListCounts,
  type ChatListPage,
  type ChatListSort,
  type ChatListState,
  type ChatListSummary,
  type ChatMessage,
  type ChatStatus,
  type ChatTurnStatus,
  type ILogger,
} from '@generatorai/shared';
import type {
  ChatListActivity,
  ChatListKeyset,
  ChatListStateFilter,
  IChatRepository,
} from '../domain/ports/IChatRepository.js';

/** A validated `GET /api/chats` query (the route parses the wire form). */
export interface ChatListRequest {
  status?: ChatStatus;
  projectIds?: readonly string[];
  agentRefs?: readonly string[];
  tags?: readonly string[];
  states?: readonly ChatListState[];
  q?: string;
  sort: ChatListSort;
  cursor?: string;
  limit: number;
  workers: boolean;
}

/** One row before the route decorates it for the wire. */
export interface ChatListEntry {
  chat: Chat;
  summary: ChatListSummary;
}

export interface ChatListServiceDeps {
  chats: Pick<IChatRepository, 'listPage'>;
  attention: { getSnapshot(): AttentionSnapshot };
  messages?: { latestBySessionIds(sessionIds: readonly string[]): Promise<Map<string, ChatMessage>> };
  agents?: { getByRef(ref: string): Promise<Agent | null> };
  /** Rows whose change stats were never computed are handed here to be filled in. */
  changeStats?: { ensure(rows: ReadonlyArray<{ workspaceId?: string }>): void };
  logger?: Pick<ILogger, 'warn'>;
}

const TURN_STATUS_OF: Partial<Record<ChatListState, ChatTurnStatus>> = {
  done: 'succeeded',
  failed: 'failed',
};

interface CursorPayload {
  s: ChatListSort;
  v: number | string;
  i: string;
}

export function encodeChatListCursor(sort: ChatListSort, keyset: ChatListKeyset): string {
  const payload: CursorPayload = { s: sort, v: keyset.value, i: keyset.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** The keyset inside a cursor, or a ValidationError (400) when it is not one of ours for this sort. */
export function decodeChatListCursor(cursor: string, sort: ChatListSort): ChatListKeyset {
  let payload: Partial<CursorPayload> | undefined;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorPayload>;
  } catch {
    payload = undefined;
  }
  const valueOk = typeof payload?.v === 'number' || typeof payload?.v === 'string';
  if (!payload || !valueOk || typeof payload.i !== 'string' || typeof payload.s !== 'string') {
    throw new ValidationError('`cursor` is not a cursor this server issued');
  }
  if (payload.s !== sort) {
    throw new ValidationError(`\`cursor\` was issued for sort=${payload.s}, not sort=${sort}`);
  }
  return { value: payload.v as number | string, id: payload.i };
}

function resolveStates(states: readonly ChatListState[], snapshot: AttentionSnapshot): ChatListStateFilter {
  const live = liveChatIds(snapshot);
  const ids = new Set<string>();
  if (states.includes('needs_you')) for (const id of live.needsYou) ids.add(id);
  if (states.includes('running')) for (const id of live.running) ids.add(id);
  const turnStatuses = states
    .map((state) => TURN_STATUS_OF[state])
    .filter((status): status is ChatTurnStatus => status !== undefined);
  return {
    ids: [...ids],
    turnStatuses,
    excludeIds: turnStatuses.length > 0 ? [...live.needsYou, ...live.running] : [],
  };
}

export class ChatListService {
  constructor(private readonly deps: ChatListServiceDeps) {}

  async list(request: ChatListRequest): Promise<ChatListPage<ChatListEntry>> {
    const after = request.cursor ? decodeChatListCursor(request.cursor, request.sort) : undefined;
    const state =
      request.states && request.states.length > 0
        ? resolveStates(request.states, this.deps.attention.getSnapshot())
        : undefined;

    const page = await this.deps.chats.listPage({
      filter: {
        ...(request.status ? { status: request.status } : {}),
        ...(request.projectIds?.length ? { projectIds: request.projectIds } : {}),
        ...(request.agentRefs?.length ? { agentRefs: request.agentRefs } : {}),
        ...(request.tags?.length ? { tags: request.tags } : {}),
        ...(request.q ? { q: request.q } : {}),
        ...(state ? { state } : {}),
        includeWorkers: request.workers,
      },
      sort: request.sort,
      ...(after ? { after } : {}),
      limit: request.limit,
    });

    const chats = page.rows.map((row) => row.chat);
    const [previews, agents] = await Promise.all([this.previews(chats), this.agents(chats)]);

    const missingStats = page.rows.filter((row) => row.chat.workspaceId && !row.activity.changes);
    if (missingStats.length > 0) this.deps.changeStats?.ensure(missingStats.map((row) => row.chat));

    const counts: ChatListCounts = {
      all: page.counts.active + page.counts.archived,
      active: page.counts.active,
      archived: page.counts.archived,
    };
    return {
      items: page.rows.map(({ chat, activity }) => ({
        chat,
        summary: summaryOf(chat, activity, previews.get(chat.sessionId), agents),
      })),
      nextCursor: page.next ? encodeChatListCursor(request.sort, page.next) : null,
      total: page.total,
      counts,
    };
  }

  /** Newest message per chat, in one query. Best effort: a list without previews beats no list. */
  private async previews(chats: readonly Chat[]): Promise<Map<string, ChatMessage>> {
    if (!this.deps.messages || chats.length === 0) return new Map();
    try {
      return await this.deps.messages.latestBySessionIds(chats.map((c) => c.sessionId));
    } catch (err) {
      this.deps.logger?.warn('[ChatList] could not load previews', {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Map();
    }
  }

  /** The current agent behind each distinct ref on the page (renames show up; the snapshot is the fallback). */
  private async agents(chats: readonly Chat[]): Promise<Map<string, Agent>> {
    const out = new Map<string, Agent>();
    const lookup = this.deps.agents;
    if (!lookup) return out;
    const refs = [...new Set(chats.map((c) => c.agentRef).filter((r): r is string => Boolean(r)))];
    await Promise.all(
      refs.map(async (ref) => {
        try {
          const agent = await lookup.getByRef(ref);
          if (agent) out.set(ref, agent);
        } catch {
          /* an unresolvable ref falls back to the snapshot */
        }
      }),
    );
    return out;
  }
}

/** One line of a message for a list row: code, images and markup collapsed. */
export function previewText(content: string): string {
  const flat = content
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [image] ')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
}

function iso(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function summaryOf(
  chat: Chat,
  activity: ChatListActivity,
  preview: ChatMessage | undefined,
  agents: Map<string, Agent>,
): ChatListSummary {
  const summary: ChatListSummary = { lastActivityAt: iso(activity.lastActivityAt) };
  if (activity.lastTurn) {
    summary.lastTurn = {
      status: activity.lastTurn.status,
      endedAt: iso(activity.lastTurn.endedAt),
      ...(activity.lastTurn.error ? { error: activity.lastTurn.error } : {}),
    };
  }
  if (activity.changes) summary.changes = { ...activity.changes };
  if (chat.agentRef) {
    const live = agents.get(chat.agentRef);
    const frozen = chat.agentSnapshot?.driving;
    if (live) summary.agent = { ref: live.ref, name: live.name, role: live.role };
    else if (frozen) summary.agent = { ref: frozen.ref, name: frozen.name, role: frozen.role };
    else summary.agent = { ref: chat.agentRef, name: chat.agentRef };
  }
  if (preview) {
    const text = previewText(preview.content);
    if (text) summary.preview = { text, role: preview.role, at: iso(preview.timestamp) };
  }
  return summary;
}

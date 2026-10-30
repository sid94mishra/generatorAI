// ────────────────────────────────────────────────────────────────
// Entity lifecycle events → list cache updates (open question #4).
//
// Every list pane (chats, runs, automations, …) refreshed on a poll timer
// and nothing else, because no server scope carried "a chat was created" or
// "a run finished" to anywhere a list could subscribe. A run could sit on
// `running` for the whole poll interval after it had already failed.
//
// The server half is `deriveStreamScopes`, which now fans a closed list of
// lifecycle kinds out to `scope=global`. This is the client half.
//
// The design decision worth stating: this is **invalidation for creations,
// mutation for everything else**, not mutation for everything.
//
// A lifecycle event carries far fewer fields than the REST row it
// corresponds to — `chat.created` has an id and a name, while the list
// renders status, model and `updatedAt`. Synthesising a row from the event
// would put a half-populated line on screen that fills itself in seconds
// later, which reads as a rendering bug. So a creation asks for a refetch of
// that one cache, and the server stays the source of truth for row SHAPE.
//
// Deletions and status changes are applied directly: both are complete
// information (an id to drop, or one field to set), neither can produce a
// half-row, and both are exactly the cases where waiting for a round trip is
// most visible — a row you just deleted lingering, or a run showing
// `running` after it failed.
// ────────────────────────────────────────────────────────────────

import type { DataCache, DataKey } from './store.js';

export interface LifecycleOutcome {
  /** Rows to write back, already updated. Absent when nothing changed. */
  patch?: { key: DataKey; rows: Array<Record<string, unknown>> };
  /** A cache to re-fetch, because the event cannot supply a full row. */
  refetch?: DataKey;
}

/** `workflow_run.<x>` → the `status` a run row should now show. */
const RUN_STATUS_BY_KIND: Record<string, string> = {
  'workflow_run.starting': 'starting',
  'workflow_run.running': 'running',
  'workflow_run.paused': 'paused',
  'workflow_run.resumed': 'running',
  'workflow_run.cancelling': 'cancelling',
  'workflow_run.completed': 'completed',
  'workflow_run.failed': 'failed',
  'workflow_run.cancelled': 'cancelled',
};

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Replaces one row by id, or returns `null` when that id is not cached. */
function setFields(
  rows: Array<Record<string, unknown>>,
  id: string,
  fields: Record<string, unknown>,
): Array<Record<string, unknown>> | null {
  const at = rows.findIndex((row) => row['id'] === id);
  // Not cached: the list has never been loaded, or the entity is outside the
  // fetched page. Inventing a row from a status event would be a row with a
  // status and nothing else.
  if (at === -1) return null;
  const next = [...rows];
  next[at] = { ...next[at], ...fields };
  return next;
}

export function applyLifecycleEvent(
  data: DataCache,
  event: { kind: string; data: Record<string, unknown> },
): LifecycleOutcome {
  const { kind } = event;

  // ── Chats ──
  if (kind === 'chat.created') return { refetch: 'chats' };

  if (kind === 'chat.deleted') {
    const id = str(event.data['chatId']);
    if (!id) return {};
    const rows = data.chats.filter((row) => row['id'] !== id);
    return rows.length === data.chats.length ? {} : { patch: { key: 'chats', rows } };
  }

  if (kind === 'chat.archived') {
    const rows = setFields(data.chats, str(event.data['chatId']), { status: 'archived' });
    return rows ? { patch: { key: 'chats', rows } } : {};
  }

  if (kind === 'chat.mode_changed') {
    const rows = setFields(data.chats, str(event.data['chatId']), {
      permissionMode: str(event.data['next']),
    });
    return rows ? { patch: { key: 'chats', rows } } : {};
  }

  if (kind === 'chat.agent_changed') {
    // `agentRef` is genuinely absent when an agent is UNBOUND, so this reads
    // the key rather than testing the string — `undefined` is the value.
    const rows = setFields(data.chats, str(event.data['chatId']), {
      agentRef: event.data['agentRef'],
    });
    return rows ? { patch: { key: 'chats', rows } } : {};
  }

  // ── Workflow runs ──
  if (kind === 'workflow_run.created' || kind === 'workflow_run.forked') {
    // A new run (a fork's `workflowRunId` is the NEW run, `ancestorRunId`
    // the source): the event cannot supply a full row, so both need the
    // server.
    return { refetch: 'runs' };
  }

  const runStatus = RUN_STATUS_BY_KIND[kind];
  if (runStatus) {
    const id = str(event.data['workflowRunId']);
    const rows = setFields(data.runs, id, {
      status: runStatus,
      ...(kind === 'workflow_run.failed' ? { error: str(event.data['error']) } : {}),
    });
    return rows ? { patch: { key: 'runs', rows } } : {};
  }

  // ── Automations ──
  //
  // An execution starting or finishing does not change the automation ROW
  // that a list renders (name, trigger, enabled, schedule) — only its
  // execution history, which the automation PANE fetches for itself. So
  // there is deliberately nothing to do here: refetching the list on every
  // execution transition would be a request per iteration of a batch
  // automation, to redraw identical rows.

  return {};
}

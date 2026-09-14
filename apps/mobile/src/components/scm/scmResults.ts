// ────────────────────────────────────────────────────────────────
// The persisted `chat.scm.result` events for one chat.
//
// Mobile's mux subscription starts at the LIVE cursor — it deliberately
// does not replay a settled chat on open, because a cold replay of a long
// transcript would re-derive every block the REST history already carries.
// The cost of that choice is the commit / PR / conflict cards: they exist
// ONLY as stream events (`chat.scm.result`), never as REST messages, so a
// chat opened after the fact showed its answers with no record of what the
// platform committed for them.
//
// This module is the missing half: page the persisted stream, keep the one
// kind that has no REST home, and fold it into `turnId → ScmFlowResult`.
//
// Pure and transport-shaped (a `ReplayFn`, not an `ApiClient`) so the paging
// and the last-write-wins rule are unit-testable in the node environment —
// `useScmResults.ts` is the thin React half, exactly as `api.ts` /
// `useScmApi.ts` are split.
// ────────────────────────────────────────────────────────────────

import type { ScmFlowResult } from '@generatorai/shared';

import { asScmResultBlock } from '../chat/timeline/scmResultBlock';

/** The event kind that carries a flow result. */
export const SCM_RESULT_KIND = 'chat.scm.result';

/**
 * `GET /api/stream/replay` returns at most 100 rows when the caller sends no
 * `limit` — which client-core's `replay()` does not. A short page therefore
 * means "the end", and that is the primary stop condition.
 */
export const REPLAY_PAGE_SIZE = 100;

/**
 * Hard cap on pages. A chat that has streamed for hours holds tens of
 * thousands of rows, and walking all of them to find four commit cards is
 * not worth a stalled screen; the cards that matter are the recent ones and
 * they are at the END of the stream, so the cap only ever loses ancient
 * history. Without it a paging bug becomes an infinite request loop.
 */
export const MAX_REPLAY_PAGES = 40;

/** One persisted stream row, as `/api/stream/replay` returns it. */
export interface ReplayRow {
  seq: number;
  kind: string;
  /** The event body. The column is `payload` — NOT `data`, which is the mux frame's name for it. */
  payload?: Record<string, unknown> | undefined;
}

export interface ReplayPage {
  rows: ReplayRow[];
  /** The last row's `seq`, or the `afterSeq` that was asked for when the page was empty. */
  nextAfterSeq: number;
}

/** A page fetcher — `(afterSeq) => api.replay('chat', chatId, afterSeq)`. */
export type ReplayFn = (afterSeq: number) => Promise<ReplayPage>;

/**
 * The flow result a `chat.scm.result` payload carries, or null.
 *
 * Validated through `asScmResultBlock` rather than a second predicate, so
 * the replay path and the live path agree on what a usable result is: a
 * malformed event drops out here instead of rendering a broken card.
 */
export function scmResultOf(payload: Record<string, unknown> | undefined): {
  turnId: string;
  result: ScmFlowResult;
} | null {
  if (!payload) return null;
  const turnId = payload['turnId'];
  if (typeof turnId !== 'string' || !turnId) return null;
  const block = asScmResultBlock({ type: 'scm_result', blockId: -1, turnId, result: payload['result'] });
  return block ? { turnId, result: block.result } : null;
}

/**
 * Every settled turn's flow result, newest write per turn.
 *
 * LAST write wins: a turn that hit conflicts and was re-run emits a second
 * `chat.scm.result`, and the card must say what is true now, not what was
 * true before the merge was resolved. Rows arrive in ascending `seq`, so
 * plain assignment into the map is the rule.
 */
export async function foldScmResults(
  replay: ReplayFn,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<Map<string, ScmFlowResult>> {
  const pageSize = options.pageSize ?? REPLAY_PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_REPLAY_PAGES;
  const byTurn = new Map<string, ScmFlowResult>();

  let afterSeq = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const { rows, nextAfterSeq } = await replay(afterSeq);
    for (const row of rows ?? []) {
      if (row.kind !== SCM_RESULT_KIND) continue;
      const found = scmResultOf(row.payload);
      if (found) byTurn.set(found.turnId, found.result);
    }
    // Three ways the walk ends, and all three must be honoured: a short
    // page (the normal end), a cursor that did not advance (an empty page,
    // where the server echoes `afterSeq` back), and a null/absent cursor.
    const count = rows?.length ?? 0;
    if (count < pageSize) break;
    if (typeof nextAfterSeq !== 'number' || nextAfterSeq <= afterSeq) break;
    afterSeq = nextAfterSeq;
  }

  return byTurn;
}

// ────────────────────────────────────────────────────────────────
// Catching up with a turn that was already running when the chat opened.
//
// The server saves the assistant message only when a turn ends, and the mux
// subscription starts at the live edge. So a chat opened (or the app cold
// started) while a turn was still going — most visibly, one parked on a plan
// review or a permission — showed the prompt and the gate card with nothing
// between them: every read, command and line of text the agent had already
// streamed lived only in the event log.
//
// The desktop rebuilds that turn by replaying the log. Mobile does the same,
// but only for the one unfinished turn: page the log over REST, keep the
// rows from the turn's first event on, feed them through the same event
// router as live frames, and open the subscription from the last one. REST
// and not the subscription's own resume, because the server replays at most
// 200 rows on subscribe and a turn parked on a plan is often twice that.
// Settled turns still come from REST history, which is why this does not
// replay them too.
//
// Pure and transport-shaped, like `scmResults.ts`, so the paging is testable
// in the node environment.
// ────────────────────────────────────────────────────────────────

import type { ChatMessage } from '@generatorai/client-core';

import type { ReplayFn, ReplayRow } from '../components/scm/scmResults';

/** The server's page ceiling; the turn start sits near the end of the log. */
export const CATCH_UP_PAGE_SIZE = 500;

/** 20,000 rows. Past that, the chat opens as before rather than stalling. */
export const CATCH_UP_MAX_PAGES = 40;

/**
 * The turn that has a prompt in history but no answer yet, or null.
 *
 * Only the LAST message counts: an earlier unanswered prompt belongs to a
 * turn that was stopped or failed, and its outcome is already history.
 */
export function unansweredTurnId(messages: readonly ChatMessage[] | undefined): string | null {
  const last = messages?.[messages.length - 1];
  if (!last || last.role !== 'user') return null;
  const turnId = last.metadata?.turnId;
  return typeof turnId === 'string' && turnId ? turnId : null;
}

export interface TurnCatchUpRows {
  /** The turn's rows, oldest first, starting with the first one that names it. */
  rows: ReplayRow[];
  /** The last seq read — the subscription's resume cursor. */
  lastSeq: number;
}

/**
 * Everything the log holds for `turnId`, or null when the log does not
 * contain the turn (or is too long to walk).
 *
 * The first row that names the turn is the start: `chat.plan.drafting` and
 * `harness.turn_start` both carry the chat's turn id, whereas the provider's
 * own sub-turns (`harness.turn_end`) carry ids of their own. Every row after
 * it belongs to the turn, since it is the chat's last.
 */
export async function turnCatchUpRows(
  replay: ReplayFn,
  turnId: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<TurnCatchUpRows | null> {
  const pageSize = options.pageSize ?? CATCH_UP_PAGE_SIZE;
  const maxPages = options.maxPages ?? CATCH_UP_MAX_PAGES;

  const rows: ReplayRow[] = [];
  let found = false;
  let afterSeq = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const { rows: pageRows, nextAfterSeq } = await replay(afterSeq);
    for (const row of pageRows ?? []) {
      if (!found && row.payload?.['turnId'] === turnId) found = true;
      if (found) rows.push(row);
    }
    const count = pageRows?.length ?? 0;
    const advanced = typeof nextAfterSeq === 'number' && nextAfterSeq > afterSeq;
    if (advanced) afterSeq = nextAfterSeq;
    if (count < pageSize || !advanced) {
      return found ? { rows, lastSeq: afterSeq } : null;
    }
  }
  return null;
}

/**
 * Every row a workflow stage has logged so far, and the last seq read.
 *
 * A running stage has no saved assistant message until it ends, so its
 * transcript can only be rebuilt from the run's log, where each agent event
 * carries the `stageRunId` it belongs to. Null when the log is too long.
 */
export async function stageCatchUpRows(
  replay: ReplayFn,
  stageRunId: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<TurnCatchUpRows | null> {
  const pageSize = options.pageSize ?? CATCH_UP_PAGE_SIZE;
  const maxPages = options.maxPages ?? CATCH_UP_MAX_PAGES;

  const rows: ReplayRow[] = [];
  let afterSeq = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const { rows: pageRows, nextAfterSeq } = await replay(afterSeq);
    for (const row of pageRows ?? []) {
      if (row.payload?.['stageRunId'] === stageRunId) rows.push(row);
    }
    const count = pageRows?.length ?? 0;
    const advanced = typeof nextAfterSeq === 'number' && nextAfterSeq > afterSeq;
    if (advanced) afterSeq = nextAfterSeq;
    if (count < pageSize || !advanced) return { rows, lastSeq: afterSeq };
  }
  return null;
}

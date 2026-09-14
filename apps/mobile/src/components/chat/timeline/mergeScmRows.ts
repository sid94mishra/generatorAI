// ────────────────────────────────────────────────────────────────
// mergeScmRows — put the persisted commit cards back into the transcript.
//
// History rows come from REST messages; the `scm_result` card comes from a
// stream event that has no REST home (`scm/scmResults.ts` folds the
// persisted ones). This is the join: for each history turn that has a
// folded result, emit ONE card after that turn's last row.
//
// Two rules the screen depends on:
//
//   • after the turn's LAST row, not its first. A turn is several rows
//     (thinking, tools, the answer); the card is what happened when the
//     turn finished, so it reads as the closing sentence.
//   • never twice. If the live stream already holds an `scm_result` block
//     for a turn — the turn that just settled while the screen was open —
//     that block is the card, and the replayed copy is skipped.
//
// Generic over the row type (the screen's `Row`, a union whose `user` and
// `activity` members have no `turnId` at all) via a `turnIdOf` accessor,
// so this stays a pure list transform with no knowledge of the screen.
// ────────────────────────────────────────────────────────────────

import type { ScmFlowResult } from '@generatorai/shared';

import { asScmResultBlock, type ScmResultBlock } from './scmResultBlock';
import type { StreamBlock } from '@generatorai/client-core';

/**
 * Insert one made item after the last item of every turn that has a result.
 *
 * Returns `items` itself when there is nothing to add, so a chat with no
 * source control never allocates a second array per render.
 */
export function mergeScmRows<T>(
  items: readonly T[],
  turnIdOf: (item: T) => string | undefined,
  results: ReadonlyMap<string, ScmFlowResult> | undefined,
  make: (turnId: string, result: ScmFlowResult) => T,
  skip?: ReadonlySet<string>,
): readonly T[] {
  if (!results || results.size === 0) return items;

  // Last index per turn, so a turn split across several messages gets its
  // card once, at the end — and a user bubble sitting between two turns
  // never attracts one.
  const lastIndex = new Map<string, number>();
  for (let i = 0; i < items.length; i += 1) {
    const turnId = turnIdOf(items[i]!);
    if (!turnId || !results.has(turnId)) continue;
    if (skip?.has(turnId)) continue;
    lastIndex.set(turnId, i);
  }
  if (lastIndex.size === 0) return items;

  const insertAfter = new Map<number, string>();
  for (const [turnId, index] of lastIndex) insertAfter.set(index, turnId);

  const out: T[] = [];
  for (let i = 0; i < items.length; i += 1) {
    out.push(items[i]!);
    const turnId = insertAfter.get(i);
    if (turnId !== undefined) out.push(make(turnId, results.get(turnId)!));
  }
  return out;
}

/** Turns the live stream already renders a card for — those are skipped. */
export function liveScmTurnIds(blocks: readonly StreamBlock[] | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  for (const block of blocks ?? []) {
    const scm = asScmResultBlock(block);
    if (scm?.turnId) out.add(scm.turnId);
  }
  return out;
}

// The block a replayed result renders as.
//
// Cached on the RESULT object, because `rowsEqual` compares `scm_result`
// rows by block identity: a fresh block per render would re-render every
// card on every token of a live turn. The query hands back the same result
// objects until it refetches, so this keeps the cards stable for exactly as
// long as they have not changed.
const replayedBlocks = new WeakMap<object, ScmResultBlock>();

/** `blockId: -1` marks a card that came from replay, not from the reducer. */
export function replayedScmBlock(
  turnId: string,
  result: ScmFlowResult,
  chatId?: string | undefined,
): ScmResultBlock {
  const cached = replayedBlocks.get(result as unknown as object);
  if (cached && cached.turnId === turnId && cached.chatId === chatId) return cached;
  const block: ScmResultBlock = {
    type: 'scm_result',
    blockId: -1,
    turnId,
    result,
    ...(chatId ? { chatId } : {}),
  };
  replayedBlocks.set(result as unknown as object, block);
  return block;
}

/** Row id for a replayed card — keyed by turn, so it is stable across refetches. */
export function replayedScmRowId(turnId: string): string {
  return `scm-replay-${turnId}`;
}

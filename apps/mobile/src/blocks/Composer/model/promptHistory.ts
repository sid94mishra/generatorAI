// ────────────────────────────────────────────────────────────────
// Prompt history — the ring behind swipe-up / ↑↓ recall.
//
// Two sources, merged (web's `promptHistory.ts` semantics): the persisted
// user messages the screen already holds, and prompts sent from this
// device that the server has not echoed back — kept in an MMKV ring of 50
// so ↑ works the instant Send lands AND across a cold start.
//
// Pure: storage is injected, so the ring is testable in node.
// ────────────────────────────────────────────────────────────────

import type { PromptHistoryEntry } from './types';

export const HISTORY_LIMIT = 50;
export const HISTORY_KEY = 'composer.history';

export interface HistoryStorage {
  getString(key: string): string | undefined;
  setString(key: string, value: string): void;
}

export function readHistoryRing(storage: HistoryStorage, key = HISTORY_KEY): PromptHistoryEntry[] {
  const raw = storage.getString(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PromptHistoryEntry =>
        typeof e === 'object' && e !== null && typeof (e as PromptHistoryEntry).text === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Append a sent prompt. An immediate repeat of the newest entry is not
 * recorded twice; the ring holds the newest `HISTORY_LIMIT`.
 */
export function pushHistoryRing(
  ring: readonly PromptHistoryEntry[],
  entry: PromptHistoryEntry,
  limit = HISTORY_LIMIT,
): PromptHistoryEntry[] {
  const text = entry.text.trim();
  if (!text && !(entry.attachments?.length)) return [...ring];
  const last = ring[ring.length - 1];
  if (last && last.text === text && (last.attachments?.length ?? 0) === (entry.attachments?.length ?? 0)) {
    return [...ring];
  }
  const next = [...ring, { ...entry, text }];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function writeHistoryRing(
  storage: HistoryStorage,
  ring: readonly PromptHistoryEntry[],
  key = HISTORY_KEY,
): void {
  storage.setString(key, JSON.stringify(ring));
}

/**
 * Persisted entries win; a local entry is dropped once a persisted one with
 * the same text arrives at or after it (5 s slack for clock skew). Oldest →
 * newest, immediate repeats collapsed.
 */
export function mergePromptHistory(
  persisted: readonly PromptHistoryEntry[],
  local: readonly PromptHistoryEntry[],
): PromptHistoryEntry[] {
  const out = persisted.slice();
  for (const l of local) {
    const echoed = persisted.some((p) => p.text === l.text && p.ts >= l.ts - 5_000);
    if (!echoed) out.push(l);
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.filter(
    (e, i) =>
      i === 0 ||
      out[i - 1]!.text !== e.text ||
      (out[i - 1]!.attachments?.length ?? 0) !== (e.attachments?.length ?? 0),
  );
}

/** Is the caret on the first / last line of the value? */
export function caretLine(value: string, caret: number): { first: boolean; last: boolean } {
  return {
    first: value.lastIndexOf('\n', caret - 1) === -1,
    last: value.indexOf('\n', caret) === -1,
  };
}

/**
 * Next history index for a step. `idx === null` means "the draft is
 * showing". `null` result means "show the draft again"; `undefined` means
 * the key should fall through (nothing to do).
 */
export function stepHistory(
  idx: number | null,
  length: number,
  dir: -1 | 1,
): number | null | undefined {
  if (length === 0) return undefined;
  if (dir === -1) {
    if (idx === null) return length - 1;
    if (idx === 0) return undefined;
    return idx - 1;
  }
  if (idx === null) return undefined;
  return idx + 1 >= length ? null : idx + 1;
}

/** Newest first, for the sheet. */
export function historyForSheet(entries: readonly PromptHistoryEntry[]): PromptHistoryEntry[] {
  return entries.slice().reverse();
}

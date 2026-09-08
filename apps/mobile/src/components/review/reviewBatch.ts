// ────────────────────────────────────────────────────────────────
// Review batch — pure helpers behind the "N pending · Send to agent" bar.
//
// The batch is the point of the feature: a reviewer reads the whole diff,
// leaves several comments, then sends them as ONE instruction. Sending each
// separately would make the agent re-plan N times.
//
// Mirrors web's `ChangesSurface.sendBatch` and the server's
// `POST /workspaces/:id/review/submit` body exactly:
//   { threadIds, target: { kind: 'chat', chatId }, note?, preview? }
// ────────────────────────────────────────────────────────────────

import type { ReviewThread } from '@generatorai/client-core';

export type ReviewIntent = 'fix' | 'question' | 'note' | 'refactor' | 'test';

export const REVIEW_INTENTS: ReadonlyArray<{ value: ReviewIntent; label: string; hint: string }> = [
  { value: 'fix', label: 'Fix', hint: 'Change the code as described' },
  { value: 'question', label: 'Question', hint: 'Answer; change only if needed' },
  { value: 'refactor', label: 'Refactor', hint: 'Restructure without behaviour change' },
  { value: 'test', label: 'Test', hint: 'Add or update tests' },
  { value: 'note', label: 'Note', hint: 'Context only; may need no change' },
];

export type ReviewSubmitTarget =
  | { kind: 'chat'; chatId: string }
  | { kind: 'stage_followup'; runId: string; stageId: string }
  | { kind: 'clipboard' };

export interface ReviewSubmitBody {
  threadIds: string[];
  target: ReviewSubmitTarget;
  note?: string;
  preview?: boolean;
}

/** Threads still waiting to be sent. Web counts `pending` and `draft` alike. */
export function isPendingThread(thread: Pick<ReviewThread, 'status'>): boolean {
  return thread.status === 'pending' || thread.status === 'draft';
}

export interface ThreadCounts {
  pending: number;
  submitted: number;
  addressed: number;
  resolved: number;
}

export function countThreads(threads: readonly Pick<ReviewThread, 'status'>[]): ThreadCounts {
  const counts: ThreadCounts = { pending: 0, submitted: 0, addressed: 0, resolved: 0 };
  for (const t of threads) {
    if (isPendingThread(t)) counts.pending += 1;
    else if (t.status === 'submitted') counts.submitted += 1;
    else if (t.status === 'addressed') counts.addressed += 1;
    else if (t.status === 'resolved') counts.resolved += 1;
  }
  return counts;
}

/**
 * The submit body for every pending thread, or null when there is nothing
 * to send. The note is trimmed and dropped when empty so the server never
 * appends a blank instruction.
 */
export function buildReviewBatch(
  threads: readonly Pick<ReviewThread, 'id' | 'status'>[],
  target: ReviewSubmitTarget,
  options: { note?: string; preview?: boolean; onlyIds?: readonly string[] } = {},
): ReviewSubmitBody | null {
  const only = options.onlyIds ? new Set(options.onlyIds) : null;
  const threadIds = threads
    .filter((t) => isPendingThread(t) && (!only || only.has(t.id)))
    .map((t) => t.id);
  if (threadIds.length === 0) return null;
  const note = options.note?.trim();
  return {
    threadIds,
    target,
    ...(note ? { note } : {}),
    ...(options.preview ? { preview: true } : {}),
  };
}

/** Bar label: `3 pending · 1 awaiting agent · 2 addressed`. */
export function batchSummary(counts: ThreadCounts): string {
  const parts: string[] = [];
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  if (counts.submitted > 0) parts.push(`${counts.submitted} awaiting agent`);
  if (counts.addressed > 0) parts.push(`${counts.addressed} addressed`);
  return parts.join(' · ');
}

/** Group threads by `alias:path`, preserving server order. */
export function groupThreadsByFile(threads: readonly ReviewThread[]): Map<string, ReviewThread[]> {
  const map = new Map<string, ReviewThread[]>();
  for (const thread of threads) {
    const key = `${thread.repoAlias}:${thread.path}`;
    const list = map.get(key);
    if (list) list.push(thread);
    else map.set(key, [thread]);
  }
  return map;
}

export const THREAD_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending: 'Pending',
  submitted: 'Sent to agent',
  addressed: 'Addressed',
  resolved: 'Resolved',
  outdated: 'Outdated',
};

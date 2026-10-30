// ────────────────────────────────────────────────────────────────
// Diff review vocabulary (03-domain §2.2 B-07): the comment intents, their
// words and hints, and the line-range label. React-free; web and mobile render
// the same words. Thread status is a status-map domain (`reviewThread` in
// ./status/maps.ts, D-18), not a table here.
// ────────────────────────────────────────────────────────────────

/** What the reviewer wants the agent to do with a comment. */
export type ReviewIntent = 'fix' | 'question' | 'note' | 'refactor' | 'test';

/** Picker order: the common case first, "context only" last. */
export const REVIEW_INTENTS: readonly ReviewIntent[] = ['fix', 'question', 'refactor', 'test', 'note'];

export const REVIEW_INTENT_LABELS: Readonly<Record<ReviewIntent, string>> = {
  fix: 'Fix',
  question: 'Question',
  refactor: 'Refactor',
  test: 'Test',
  note: 'Note',
};

/** One-line explanation shown on the intent picker. */
export const REVIEW_INTENT_HINTS: Readonly<Record<ReviewIntent, string>> = {
  fix: 'Change the code as described',
  question: 'Answer; change only if needed',
  refactor: 'Restructure without behaviour change',
  test: 'Add or update tests',
  note: 'Context only; may need no change',
};

/** `L20` for one line, `L18–21` for a range (en dash). */
export function reviewLineLabel(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}–${endLine}`;
}

// ────────────────────────────────────────────────────────────────
// insertAtCaret — pure text-insertion helper for the Phase 1 voice-input
// rewrite (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C.2).
//
// Deliberately has zero dependency on React, the DOM, or any textarea ref
// so it's testable as plain data-in/data-out — the caret math (when to add
// a separating space, where the caret lands afterward) is exactly the kind
// of logic that's easy to get subtly wrong and cheap to verify in
// isolation. ChatInput.tsx's `insertAtCaret` callback is a thin wrapper
// that reads the textarea's live selection, calls this, and applies the
// result.
// ────────────────────────────────────────────────────────────────

export interface CaretInsertResult {
  /** The full new value after insertion. */
  text: string;
  /** Where the caret should land — immediately after the inserted text. */
  caret: number;
}

/**
 * Insert `rawInsertText` (trimmed) into `value` between `selectionStart` and
 * `selectionEnd` (replacing any selected range), adding a single space on
 * either side only where the surrounding text doesn't already have
 * whitespace there — so dictation never produces "helloworld" nor
 * "hello  world" (double space).
 *
 * Returns `null` when there's nothing to insert (empty/whitespace-only
 * input) — callers should treat that as a no-op, not clear the selection.
 */
export function insertTextAtCaret(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  rawInsertText: string,
): CaretInsertResult | null {
  const insertText = rawInsertText.trim();
  if (!insertText) return null;

  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const leadingSpace = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  // No trailing space before whitespace OR common closing punctuation —
  // "correcting 'world' to 'there' in 'Hello world!'" must produce
  // "Hello there!", not "Hello there !".
  const trailingSpace = after.length > 0 && !/^[\s.,!?;:)\]}'"]/.test(after) ? ' ' : '';

  return {
    text: `${before}${leadingSpace}${insertText}${trailingSpace}${after}`,
    caret: selectionStart + leadingSpace.length + insertText.length,
  };
}

/**
 * Sequences repeated `insertTextAtCaret` calls so they compose correctly
 * even when two arrive before the browser has repainted the textarea with
 * the first insertion's result (React defers applying `selectionStart`/
 * `selectionEnd` to the next animation frame — see ChatInput.tsx's
 * `insertAtCaret`). Two dictated segments arriving back-to-back is the
 * realistic trigger: reading the textarea's live DOM selection for the
 * second one would read the STALE, pre-first-insertion position, reversing
 * spoken order ("A" then "B" ends up as "B A").
 *
 * The fix: once an insertion computes where the caret WILL be, remember
 * that logical position and use it — instead of the DOM's current
 * selection — as the basis for the next insertion, until something
 * confirms the DOM has actually caught up (`consumePending`) or a genuine
 * user interaction makes the pending position stale on purpose
 * (`clearPending`).
 */
export class CaretInsertionSequencer {
  private pendingCaret: number | null = null;

  /**
   * Compute the next insertion. `domSelectionStart`/`domSelectionEnd`
   * should be the textarea's LIVE selection — only used when there's no
   * still-pending logical position from a prior insertion.
   */
  insert(
    value: string,
    domSelectionStart: number,
    domSelectionEnd: number,
    rawInsertText: string,
  ): CaretInsertResult | null {
    const start = this.pendingCaret ?? domSelectionStart;
    const end = this.pendingCaret ?? domSelectionEnd;
    const result = insertTextAtCaret(value, start, end, rawInsertText);
    if (result) this.pendingCaret = result.caret;
    return result;
  }

  /**
   * Call once the pending caret position has been (or is about to be)
   * applied to the real DOM. Returns the position that was pending, or
   * `null` if nothing was. Idempotent — a second call after the first
   * returns `null`, so multiple queued rAF callbacks from rapid
   * insertions don't fight each other.
   */
  consumePending(): number | null {
    const caret = this.pendingCaret;
    this.pendingCaret = null;
    return caret;
  }

  /**
   * Call on any genuine manual user interaction (keydown, paste, click).
   * Discards a stale pending position so a `segment`/`final` insertion
   * that arrives moments later (e.g. network latency after a `pause`
   * frame was sent) lands at the user's NEW position, not one computed
   * before they touched anything.
   */
  clearPending(): void {
    this.pendingCaret = null;
  }
}

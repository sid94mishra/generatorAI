// ────────────────────────────────────────────────────────────────
// A line cursor for the diff pane (open question #21).
//
// `diff.comment` used to ask "which line?" through a chained input overlay,
// because `review create`'s `startLine` is required server-side and
// `ChangesPane` had no concept of a selected LINE — only a selected FILE.
// Typing a line number while looking at a diff that already shows line
// numbers is the kind of thing a terminal UI gets mocked for.
//
// `parseDiffLines` already produces `oldLine`/`newLine` per row, so the
// cursor needs no new data: it is an index into the rows the pane already
// renders, and the anchor it produces carries the side as well as the
// number — which is more than the prompt could, since a typed number does
// not say whether it means the old file or the new one.
// ────────────────────────────────────────────────────────────────

import type { DiffLine } from '@generatorai/tui-kit';

export interface LineAnchor {
  /** 1-based line number in whichever side `side` names. */
  startLine: number;
  /** What `review create --side` takes. */
  side: 'additions' | 'deletions';
  /** The line's text, for `--anchor-text` drift detection. */
  anchorText: string;
}

/** Rows a cursor may land on — a header or a file marker anchors nothing. */
export function isAnchorable(line: DiffLine | undefined): boolean {
  return line !== undefined && (line.type === 'add' || line.type === 'remove' || line.type === 'context');
}

/**
 * Moves the cursor by `delta`, skipping rows that cannot be commented on.
 *
 * Skipping rather than stopping: hunk headers and `diff --git` lines are
 * scenery, and a cursor that parks on one and then refuses to comment reads
 * as the key being broken.
 */
export function moveLineCursor(lines: readonly DiffLine[], from: number, delta: 1 | -1): number {
  if (lines.length === 0) return 0;
  let at = from;
  for (let steps = 0; steps < lines.length; steps++) {
    at += delta;
    if (at < 0 || at >= lines.length) return clampToAnchorable(lines, from);
    if (isAnchorable(lines[at])) return at;
  }
  return clampToAnchorable(lines, from);
}

/** The nearest anchorable row at or after `from` — used when a patch first loads. */
export function firstAnchorableLine(lines: readonly DiffLine[]): number {
  for (let i = 0; i < lines.length; i++) if (isAnchorable(lines[i])) return i;
  return 0;
}

function clampToAnchorable(lines: readonly DiffLine[], from: number): number {
  return isAnchorable(lines[from]) ? from : firstAnchorableLine(lines);
}

/**
 * What the cursor is pointing at, as `review create` wants it.
 *
 * A REMOVED line only exists in the old file, so it anchors to `deletions`
 * and its `oldLine`; everything else anchors to the new file. Getting this
 * backwards attaches the comment to a line number that exists but is the
 * wrong one — a silently misplaced review comment, which is worse than none.
 */
export function anchorFor(lines: readonly DiffLine[], index: number): LineAnchor | null {
  const line = lines[index];
  if (!isAnchorable(line)) return null;

  if (line!.type === 'remove') {
    if (line!.oldLine === undefined) return null;
    return { startLine: line!.oldLine, side: 'deletions', anchorText: line!.content };
  }
  if (line!.newLine === undefined) return null;
  return { startLine: line!.newLine, side: 'additions', anchorText: line!.content };
}

/**
 * A scroll offset that keeps `index` on screen.
 *
 * Returns the CURRENT offset when the cursor is already visible, so moving
 * within the viewport does not scroll the diff out from under the reader.
 */
export function scrollToShow(index: number, scrollTop: number, viewport: number): number {
  if (viewport <= 0) return scrollTop;
  if (index < scrollTop) return index;
  if (index >= scrollTop + viewport) return index - viewport + 1;
  return scrollTop;
}

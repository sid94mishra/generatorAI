// ────────────────────────────────────────────────────────────────
// The diff line cursor (open question #21).
//
// `diff.comment` used to ask "which line?" through a text prompt, while
// showing a diff that already displays line numbers. The cursor replaces
// that — and supplies something the prompt never could: which SIDE the
// number refers to.
//
// The failure this guards is silent and serious: anchoring a review comment
// to a line number that exists but is the wrong one puts the comment on
// unrelated code, which is worse than no comment at all.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { parseDiffLines } from '@generatorai/tui-kit';
import {
  anchorFor,
  firstAnchorableLine,
  isAnchorable,
  moveLineCursor,
  scrollToShow,
} from '../diffCursor.js';

// Real unified-diff text, so the row types and line numbers come from the
// same parser the pane renders with rather than from hand-built fixtures.
const PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -10,4 +10,5 @@',
  ' const a = 1;',
  '-const removed = 2;',
  '+const added = 2;',
  '+const alsoAdded = 3;',
  ' const b = 4;',
].join('\n');

const lines = parseDiffLines(PATCH);

describe('isAnchorable', () => {
  it('accepts the rows that correspond to real file lines', () => {
    expect(lines.filter(isAnchorable).map((l) => l.type).sort()).toEqual([
      'add',
      'add',
      'context',
      'context',
      'remove',
    ]);
  });

  it('rejects headers and file markers — they anchor nothing', () => {
    expect(lines.filter((l) => l.type === 'meta').every((l) => !isAnchorable(l))).toBe(true);
    expect(lines.filter((l) => l.type === 'hunk').every((l) => !isAnchorable(l))).toBe(true);
    expect(isAnchorable(undefined)).toBe(false);
  });
});

describe('firstAnchorableLine', () => {
  it('skips the header block so the cursor never starts on scenery', () => {
    // A cursor parked on `@@` would refuse the very next keypress, which
    // reads as the key being broken.
    expect(lines[firstAnchorableLine(lines)]?.type).toBe('context');
  });

  it('returns 0 for a patch with nothing anchorable, without throwing', () => {
    expect(firstAnchorableLine(parseDiffLines('diff --git a/x b/x'))).toBe(0);
    expect(firstAnchorableLine([])).toBe(0);
  });
});

describe('moveLineCursor', () => {
  const start = firstAnchorableLine(lines);

  it('steps to the next anchorable row', () => {
    const next = moveLineCursor(lines, start, 1);
    expect(next).toBeGreaterThan(start);
    expect(isAnchorable(lines[next])).toBe(true);
  });

  it('skips over hunk headers rather than parking on one', () => {
    // Walking the whole diff must never land on a non-anchorable row.
    let at = start;
    for (let i = 0; i < lines.length; i++) {
      at = moveLineCursor(lines, at, 1);
      expect(isAnchorable(lines[at]), `stopped on ${lines[at]?.type}`).toBe(true);
    }
  });

  it('stays put at either end instead of wrapping', () => {
    // Wrapping from the last line of a diff to the first would move the
    // reader's eye across the whole file for one keypress.
    let at = start;
    for (let i = 0; i < lines.length; i++) at = moveLineCursor(lines, at, 1);
    expect(moveLineCursor(lines, at, 1)).toBe(at);
    expect(moveLineCursor(lines, start, -1)).toBe(start);
  });

  it('is a no-op on an empty diff', () => {
    expect(moveLineCursor([], 0, 1)).toBe(0);
  });
});

describe('anchorFor', () => {
  const findIndex = (predicate: (line: (typeof lines)[number]) => boolean): number =>
    lines.findIndex(predicate);

  it('anchors an ADDED line to the new file', () => {
    const anchor = anchorFor(lines, findIndex((l) => l.content === 'const added = 2;'))!;
    expect(anchor.side).toBe('additions');
    expect(anchor.startLine).toBe(11);
    expect(anchor.anchorText).toBe('const added = 2;');
  });

  it('anchors a REMOVED line to the old file', () => {
    // Getting this backwards attaches the comment to a line number that
    // exists but is the wrong one — a silently misplaced review comment.
    const anchor = anchorFor(lines, findIndex((l) => l.type === 'remove'))!;
    expect(anchor.side).toBe('deletions');
    expect(anchor.startLine).toBe(11);
  });

  it('anchors a context line to the new file, which is what a reviewer is reading', () => {
    const anchor = anchorFor(lines, findIndex((l) => l.content === 'const a = 1;'))!;
    expect(anchor.side).toBe('additions');
    expect(anchor.startLine).toBe(10);
  });

  it('carries the line text, so the server can detect drift', () => {
    // A number alone cannot tell the server the line moved; `anchorText` can.
    expect(anchorFor(lines, findIndex((l) => l.type === 'add'))?.anchorText).toBeTruthy();
  });

  it('returns null for a header, an out-of-range index, or no cursor at all', () => {
    expect(anchorFor(lines, findIndex((l) => l.type === 'hunk'))).toBeNull();
    expect(anchorFor(lines, 999)).toBeNull();
    expect(anchorFor(lines, -1)).toBeNull();
  });
});

describe('scrollToShow', () => {
  it('leaves the offset alone while the cursor is on screen', () => {
    // Scrolling on every keypress would move the diff out from under the
    // reader for no reason.
    expect(scrollToShow(12, 10, 10)).toBe(10);
    expect(scrollToShow(10, 10, 10)).toBe(10);
    expect(scrollToShow(19, 10, 10)).toBe(10);
  });

  it('scrolls just far enough when the cursor leaves the window', () => {
    expect(scrollToShow(20, 10, 10)).toBe(11);
    expect(scrollToShow(5, 10, 10)).toBe(5);
  });

  it('does nothing for a zero-height viewport rather than dividing by it', () => {
    expect(scrollToShow(5, 3, 0)).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────
// AnchorResolver — keep review comments attached as code moves
// ────────────────────────────────────────────────────────────────
//
// A comment is anchored to a line RANGE, but line numbers are the least
// stable thing about a file. When the agent edits above the anchor, every
// number shifts; when it rewrites the anchored lines, the anchor is gone.
//
// Strategy (mirrors what GitHub does, plus content verification):
//   1. Walk the patch hunks to map old line → new line.
//   2. Verify the mapped range still hashes to the recorded anchor.
//   3. On mismatch, fuzzy-search a window around the mapped position.
//   4. Only give up (→ `outdated`) when the content is genuinely gone.
//
// Content verification is what makes this reliable: a pure line-number shift
// is silently absorbed, and a rewrite is correctly detected instead of
// leaving the comment pointing at unrelated code.

import { createHash } from 'node:crypto';
import { parsePatch } from 'diff';

/** How far to search around the mapped position before giving up. */
const FUZZ_WINDOW_LINES = 40;

export interface AnchorInput {
  startLine: number;
  endLine: number;
  anchorHash: string;
}

export type AnchorOutcome =
  | { kind: 'exact'; startLine: number; endLine: number }
  | { kind: 'shifted'; startLine: number; endLine: number }
  | { kind: 'fuzzy'; startLine: number; endLine: number }
  | { kind: 'outdated' };

/**
 * sha256 of the anchored text.
 *
 * Normalisation is deliberately narrow: trailing whitespace and blank lines
 * at the edges are ignored (they change constantly and never carry meaning),
 * but LEADING indentation is preserved. In Python — and in any re-indented
 * block — indentation is semantic, so folding it away would let an anchor
 * match a differently-scoped copy of the same statements.
 */
export function hashAnchor(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  // Drop only fully-blank leading/trailing lines.
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * Map a line number through a unified patch (old → new).
 * Returns null when the line was deleted by the patch.
 */
export function mapLineThroughPatch(patch: string, line: number): number | null {
  let parsed;
  try {
    parsed = parsePatch(patch);
  } catch {
    return line;
  }
  const file = parsed[0];
  if (!file || file.hunks.length === 0) return line;

  let offset = 0;
  for (const hunk of file.hunks) {
    const hunkOldStart = hunk.oldStart;
    const hunkOldEnd = hunk.oldStart + hunk.oldLines - 1;

    // Entirely before this hunk → only the accumulated offset applies.
    if (line < hunkOldStart) return line + offset;

    if (line <= hunkOldEnd) {
      // Inside the hunk — walk its lines to find the exact mapping.
      let oldCursor = hunk.oldStart;
      let newCursor = hunk.newStart;
      for (const raw of hunk.lines) {
        const marker = raw[0];
        if (marker === '-') {
          if (oldCursor === line) return null; // deleted
          oldCursor++;
        } else if (marker === '+') {
          newCursor++;
        } else {
          if (oldCursor === line) return newCursor;
          oldCursor++;
          newCursor++;
        }
      }
      return null;
    }

    offset += hunk.newLines - hunk.oldLines;
  }

  return line + offset;
}

/**
 * Re-anchor a comment against the new content of its file.
 *
 * `patch` may be omitted when only the content is available; the resolver
 * then falls back to a pure content search, which still recovers the anchor
 * as long as the text survived somewhere in the file.
 */
export function resolveAnchor(
  anchor: AnchorInput,
  newContent: string | null,
  patch?: string,
): AnchorOutcome {
  if (newContent === null) return { kind: 'outdated' };

  const lines = newContent.split(/\r?\n/);
  const span = anchor.endLine - anchor.startLine;

  const matchesAt = (start1Based: number): boolean => {
    if (start1Based < 1 || start1Based + span > lines.length) return false;
    const slice = lines.slice(start1Based - 1, start1Based + span).join('\n');
    return hashAnchor(slice) === anchor.anchorHash;
  };

  // 1. Unchanged position.
  if (matchesAt(anchor.startLine)) {
    return { kind: 'exact', startLine: anchor.startLine, endLine: anchor.endLine };
  }

  // 2. Position implied by the patch.
  if (patch) {
    const mappedStart = mapLineThroughPatch(patch, anchor.startLine);
    if (mappedStart !== null && matchesAt(mappedStart)) {
      return { kind: 'shifted', startLine: mappedStart, endLine: mappedStart + span };
    }
  }

  // 3. Fuzzy window around the original position, expanding outward so the
  //    nearest match wins (important when the same snippet repeats).
  for (let delta = 1; delta <= FUZZ_WINDOW_LINES; delta++) {
    for (const candidate of [anchor.startLine + delta, anchor.startLine - delta]) {
      if (matchesAt(candidate)) {
        return { kind: 'fuzzy', startLine: candidate, endLine: candidate + span };
      }
    }
  }

  // 4. Whole-file scan — the anchor may have moved a long way (file split,
  //    large insertion). Cheap enough: one hash per candidate line.
  for (let start = 1; start + span <= lines.length; start++) {
    if (matchesAt(start)) {
      return { kind: 'fuzzy', startLine: start, endLine: start + span };
    }
  }

  return { kind: 'outdated' };
}

/**
 * Whether a changed line range overlaps a thread's anchor — used to decide
 * that a submitted thread has been "addressed" by the agent's latest edit.
 */
export function rangesOverlap(
  a: { startLine: number; endLine: number },
  b: { startLine: number; endLine: number },
): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/** Line ranges touched on the new side of a unified patch. */
export function changedRangesFromPatch(
  patch: string,
): Array<{ startLine: number; endLine: number }> {
  let parsed;
  try {
    parsed = parsePatch(patch);
  } catch {
    return [];
  }
  const file = parsed[0];
  if (!file) return [];

  const ranges: Array<{ startLine: number; endLine: number }> = [];
  for (const hunk of file.hunks) {
    let newCursor = hunk.newStart;
    let runStart: number | null = null;
    for (const raw of hunk.lines) {
      const marker = raw[0];
      if (marker === '+') {
        if (runStart === null) runStart = newCursor;
        newCursor++;
      } else if (marker === '-') {
        // A deletion has no new-side line; attribute it to the current point
        // so a pure deletion still marks the surrounding range as touched.
        if (runStart === null) runStart = newCursor;
      } else {
        if (runStart !== null) {
          ranges.push({ startLine: runStart, endLine: Math.max(runStart, newCursor - 1) });
          runStart = null;
        }
        newCursor++;
      }
    }
    if (runStart !== null) {
      ranges.push({ startLine: runStart, endLine: Math.max(runStart, newCursor - 1) });
    }
  }
  return ranges;
}

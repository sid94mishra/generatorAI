// ─────────────────────────────────────────────────────────────────────────────
// IncrementalMarkdown — P0-47: append-only, block-memoised markdown renderer.
//
// Streaming produces one token at a time.  Without memoisation the entire
// markdown tree is torn down and rebuilt for every character.  This component
// splits the incoming text into "completed" blocks and a live tail block, then
// wraps each block in React.memo so only the tail re-renders per token.
//
// ── Two properties this file is responsible for ──────────────────────────────
//
//  1. APPEND-ONLY (P0-47).  The splitter never re-scans committed text.  It
//     keeps the offset at which the live tail begins and resumes there, so the
//     per-token cost is proportional to the length of the current paragraph,
//     not to the length of the answer so far.  A 40 KB response used to cost a
//     40 KB scan per token; it now costs a few hundred bytes.
//
//  2. STREAMING RENDER == FINAL RENDER (N2).  Each committed block is parsed
//     by its OWN ReactMarkdown instance, so a construct that spans a blank
//     line — a loose list, a link-reference definition emitted after its use —
//     would break while streaming and silently repair when the turn completed
//     and StreamPanel switched to a single `MarkdownRenderer`.  A boundary is
//     therefore only committed when the text after it cannot possibly continue
//     the text before it.  NOT committing is always safe (it costs one larger
//     re-parse); committing wrongly changes what the user sees.
//
// Splitting rules (ordered, applied left-to-right):
//   1. A closing code fence (``` or ~~~, matching the opening marker) ends a
//      fence block.  The block is committed the moment the closing fence is
//      followed by at least one more line.
//   2. A blank line that is both preceded and followed by non-blank content
//      commits the paragraph above it — but ONLY when the following line can
//      not continue it (see `boundaryIsSafe`).
//   3. Everything else accumulates in the current (tail) buffer.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useRef } from 'react';
import { MarkdownBody } from '@/components/chat/MarkdownRenderer.js';
import { cn } from '@/lib/utils.js';
import { countFallback } from '@/lib/clientMetrics.js';

// ── Memoised single-block renderer ──────────────────────────────────────────

interface MarkdownBlockProps {
  content: string;
}

/**
 * Renders one stable markdown block.  Re-renders only when `content` changes.
 *
 * `MarkdownBody`, not `MarkdownRenderer`: the `.markdown-content` wrapper is
 * hoisted to the component below so that a streaming turn and a completed one
 * produce the same DOM shape — which is the whole point of N2.
 */
const MarkdownBlock = React.memo(function MarkdownBlock({ content }: MarkdownBlockProps) {
  return <MarkdownBody content={content} />;
});
MarkdownBlock.displayName = 'MarkdownBlock';

// ── Block splitter ───────────────────────────────────────────────────────────

export interface SplitState {
  /** The exact source this state describes. */
  text: string;
  /** Committed, stable blocks (never change once emitted). */
  blocks: string[];
  /** The live tail block (may grow with the next token). */
  tail: string;
  /**
   * Offset into `text` at which `tail` begins — the resume point for the next
   * token.  A block is only ever committed at a boundary where the scanner is
   * outside any fence, so resuming here needs no other carried state.
   */
  cursor: number;
}

const EMPTY_STATE: SplitState = { text: '', blocks: [], tail: '', cursor: 0 };

/** Bullet or ordered list marker, at a paragraph-continuing indent. */
const LIST_ITEM_RE = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
/** Block quote marker. */
const BLOCKQUOTE_RE = /^ {0,3}>/;
/** Raw HTML block opener. */
const HTML_BLOCK_RE = /^ {0,3}</;
/**
 * A link-reference or footnote definition anywhere in the buffer.
 *
 * A definition is visible to the WHOLE document, including blocks committed
 * before it arrived, so no per-block parse can resolve it — `[text][ref]` in
 * block 1 renders as literal text until block 7 delivers `[ref]: https://…`.
 * There is no incremental answer to that: the only correct render is a single
 * parse of everything.
 */
const DEFINITION_RE = /^ {0,3}\[[^\]\n]+\]:[ \t]*\S/m;

/**
 * Can a blank line here end the block above it?
 *
 * Only when the next non-blank line starts something new.  A list marker, a
 * quote marker or any leading whitespace all continue the construct above —
 * splitting there turns one loose `<ul>` into two, or detaches a nested
 * paragraph from its list item.
 */
function boundaryIsSafe(
  pendingFirstLine: string,
  nextLine: string,
  nextLineComplete: boolean,
): boolean {
  // An open raw-HTML block swallows blank lines until a closing condition we
  // do not track; never split inside one.
  if (HTML_BLOCK_RE.test(pendingFirstLine)) return false;
  if (LIST_ITEM_RE.test(nextLine)) return false;
  if (BLOCKQUOTE_RE.test(nextLine)) return false;
  if (/^[ \t]/.test(nextLine)) return false;
  // A line the model has not finished typing is judged on a prefix. Every
  // continuation marker is one character that LIST_ITEM_RE / BLOCKQUOTE_RE
  // already catch on its own — except an ordered marker, whose number arrives
  // before its dot. `2` reads as a fresh paragraph and becomes `2.` on the
  // very next token, which is how a loose ordered list ended up as three
  // `<ol start=n>` elements while streaming and one `<ol>` when it finished.
  if (!nextLineComplete && /^ {0,3}\d{1,9}$/.test(nextLine)) return false;
  return true;
}

/**
 * Scan `text` from `start`, appending any newly completed blocks to
 * `priorBlocks`.  Everything before `start` is already committed and is never
 * looked at again — that is what makes this append-only.
 */
function scanFrom(text: string, start: number, priorBlocks: readonly string[]): SplitState {
  const blocks = priorBlocks.slice();
  const lines = text.slice(start).split('\n');

  let blockStart = start; // offset where the pending block begins
  let offset = start;     // offset of `lines[i]`
  let hasContent = false; // pending block has at least one non-blank line
  let inFence = false;
  let fenceChar: '`' | '~' = '`';
  let fenceLen = 3;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineEnd = offset + line.length;
    const nextStart = lineEnd + 1;
    const trimmed = line.trimStart();

    if (!inFence) {
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        fenceChar = trimmed[0] as '`' | '~';
        // Count consecutive identical fence chars (may be >3).
        let len = 0;
        for (const ch of trimmed) {
          if (ch === fenceChar) len++;
          else break;
        }
        fenceLen = len;
        inFence = true;
        hasContent = true;
      } else if (line.trim() === '') {
        // Blank line — a potential paragraph boundary.
        let nextNonEmpty: string | undefined;
        let nextNonEmptyIdx = -1;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j]!.trim() !== '') { nextNonEmpty = lines[j]; nextNonEmptyIdx = j; break; }
        }
        const pendingFirst = firstNonBlankLine(text.slice(blockStart, offset));
        if (
          hasContent &&
          nextNonEmpty !== undefined &&
          i < lines.length - 1 &&
          boundaryIsSafe(pendingFirst, nextNonEmpty, nextNonEmptyIdx < lines.length - 1)
        ) {
          // Commit the block above, dropping the blank separator: it is
          // leading whitespace on the next block, which markdown ignores.
          blocks.push(text.slice(blockStart, offset).replace(/\n$/, ''));
          blockStart = nextStart;
          hasContent = false;
        }
        // Otherwise the blank stays in the pending block, which is what keeps
        // a loose list one list.
      } else {
        hasContent = true;
      }
    } else {
      // Inside a code fence — look for a closing marker.
      let closingLen = 0;
      if (trimmed.startsWith(fenceChar.repeat(3))) {
        for (const ch of trimmed) {
          if (ch === fenceChar) closingLen++;
          else break;
        }
      }
      // A closing fence must have at least `fenceLen` of the same char and
      // nothing else on the line (optionally trailing spaces).
      if (
        closingLen >= fenceLen &&
        trimmed.slice(closingLen).trim() === '' &&
        // Only commit the fence block if there is still more content to come —
        // if this is the last line the fence is still "in progress".
        i < lines.length - 1
      ) {
        inFence = false;
        blocks.push(text.slice(blockStart, lineEnd));
        blockStart = nextStart;
        hasContent = false;
      }
    }

    offset = nextStart;
  }

  return { text, blocks, tail: text.slice(blockStart), cursor: blockStart };
}

function firstNonBlankLine(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim() !== '') return line;
  }
  return '';
}

/**
 * Fold the next token into an existing split.
 *
 * The fast path is the streaming one: `text` extends `prev.text`, so only the
 * tail is re-scanned.  Anything else (a shorter buffer, an edit, a fresh
 * message) falls back to a full scan, which is what a first render does too.
 */
export function advanceSplit(prev: SplitState, text: string): SplitState {
  if (text === prev.text) return prev;
  if (!text) return EMPTY_STATE;

  // A definition anywhere disables splitting entirely — see DEFINITION_RE.
  if (DEFINITION_RE.test(text)) {
    countFallback('markdownFullReparse');
    return { text, blocks: [], tail: text, cursor: 0 };
  }

  if (prev.text && text.startsWith(prev.text) && prev.cursor <= text.length) {
    countFallback('markdownIncrementalReuse');
    return scanFrom(text, prev.cursor, prev.blocks);
  }
  return scanFrom(text, 0, []);
}

/** Test seam: split a complete document from scratch. */
export function splitIntoBlocks(text: string): { blocks: string[]; tail: string } {
  const state = advanceSplit(EMPTY_STATE, text);
  return { blocks: state.blocks, tail: state.tail };
}

// ── Public component ─────────────────────────────────────────────────────────

export interface IncrementalMarkdownProps {
  /** The full markdown text accumulated so far. */
  content: string;
  className?: string;
}

/**
 * P0-47 — incremental markdown renderer with block-level memoisation.
 *
 * Drop-in replacement for `<MarkdownRenderer content={…} />` when rendering
 * a streaming turn.  Non-streaming callers can keep using MarkdownRenderer
 * directly — the memoisation overhead there is unnecessary.
 */
export function IncrementalMarkdown({ content, className }: IncrementalMarkdownProps) {
  // The split state carries across renders so each token re-scans only the
  // live tail. Writing the ref from inside useMemo is safe because
  // `advanceSplit` is idempotent for a given `content`: a discarded or
  // double-invoked render recomputes the same value, and a state left over
  // from an abandoned render is repaired by the `startsWith` check.
  const stateRef = useRef<SplitState>(EMPTY_STATE);
  const { blocks, tail } = useMemo(() => {
    const next = advanceSplit(stateRef.current, content);
    stateRef.current = next;
    return next;
  }, [content]);

  return (
    <div className={cn('markdown-content text-sm', className)}>
      {blocks.map((block, i) => (
        // `key={i}` is intentionally stable: completed blocks are only ever
        // appended; existing indices never shift.
        <MarkdownBlock key={i} content={block} />
      ))}
      {tail ? (
        // The tail key includes block count so React remounts the component
        // exactly once when the tail graduates to a completed block and a new
        // tail begins — avoiding incorrect prop-equality short-circuits.
        <MarkdownBlock key={`tail:${blocks.length}`} content={tail} />
      ) : null}
    </div>
  );
}

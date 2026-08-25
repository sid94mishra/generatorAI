// ─────────────────────────────────────────────────────────────────────────────
// IncrementalMarkdown — P0-47: block-level memoised markdown renderer.
//
// Streaming produces one token at a time.  Without memoisation the entire
// markdown tree is torn down and rebuilt for every character.  This component
// splits the incoming text into "completed" paragraph / code-fence blocks and a
// live tail block, then wraps each block in React.memo so only the tail
// re-renders per token.  Completed blocks are stable: their content never
// changes once the boundary is committed.
//
// Splitting rules (ordered, applied left-to-right):
//   1. A closing code fence (``` or ~~~, matching the opening marker) ends a
//      fence block.  The block is committed the moment the closing fence is
//      followed by at least one more line.
//   2. A blank line that is both preceded and followed by non-blank content
//      commits the paragraph above it.
//   3. Everything else accumulates in the current (tail) buffer.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer.js';

// ── Memoised single-block renderer ──────────────────────────────────────────

interface MarkdownBlockProps {
  content: string;
}

/** Renders one stable markdown block.  Re-renders only when `content` changes. */
const MarkdownBlock = React.memo(function MarkdownBlock({ content }: MarkdownBlockProps) {
  return <MarkdownRenderer content={content} />;
});
MarkdownBlock.displayName = 'MarkdownBlock';

// ── Block splitter ───────────────────────────────────────────────────────────

interface SplitResult {
  /** Committed, stable blocks (never change once emitted). */
  blocks: string[];
  /** The live tail block (may grow with the next token). */
  tail: string;
}

/**
 * Split `text` into completed markdown blocks and a live tail.
 *
 * Completed blocks are safe to memoize because they will never receive more
 * content.  The tail is still growing.
 */
function splitIntoBlocks(text: string): SplitResult {
  if (!text) return { blocks: [], tail: '' };

  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let fenceChar = '`'; // '`' or '~'
  let fenceLen = 3;    // minimum length of the opening fence marker

  const commitCurrent = () => {
    if (current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();

    if (!inFence) {
      // Detect opening fence
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        fenceChar = trimmed[0] as '`' | '~';
        // Count consecutive identical fence chars (may be >3)
        let len = 0;
        for (const ch of trimmed) {
          if (ch === fenceChar) len++;
          else break;
        }
        fenceLen = len;
        inFence = true;
        current.push(line);
      } else if (line.trim() === '') {
        // Blank line — potential paragraph boundary
        const nextNonEmpty = lines.slice(i + 1).find((l) => l.trim() !== '');
        if (current.length > 0 && nextNonEmpty !== undefined && i < lines.length - 1) {
          // There is content before AND after this blank → commit the block above
          commitCurrent();
          // Don't push the blank line into the new block — it would be leading
          // whitespace on the next block, which is fine to omit.
        } else {
          // Trailing blank or no content before — keep in current buffer
          current.push(line);
        }
      } else {
        current.push(line);
      }
    } else {
      // Inside a code fence — look for a closing marker
      current.push(line);
      const closingCandidate = trimmed;
      let closingLen = 0;
      if (closingCandidate.startsWith(fenceChar.repeat(3))) {
        for (const ch of closingCandidate) {
          if (ch === fenceChar) closingLen++;
          else break;
        }
      }
      // A closing fence must have at least `fenceLen` of the same char and
      // nothing else on the line (optionally trailing spaces).
      if (
        closingLen >= fenceLen &&
        closingCandidate.slice(closingLen).trim() === '' &&
        // Only commit the fence block if there is still more content to come —
        // if this is the last line the fence is still "in progress".
        i < lines.length - 1
      ) {
        inFence = false;
        commitCurrent();
      }
    }
  }

  // Whatever remains in `current` is the live tail
  return { blocks, tail: current.join('\n') };
}

// ── Public component ─────────────────────────────────────────────────────────

export interface IncrementalMarkdownProps {
  /** The full markdown text accumulated so far. */
  content: string;
}

/**
 * P0-47 — incremental markdown renderer with block-level memoisation.
 *
 * Drop-in replacement for `<MarkdownRenderer content={…} />` when rendering
 * a streaming turn.  Non-streaming callers can keep using MarkdownRenderer
 * directly — the memoisation overhead there is unnecessary.
 */
export function IncrementalMarkdown({ content }: IncrementalMarkdownProps) {
  // Re-splitting on every render is cheap (single O(n) scan over lines).
  // The expensive part — MarkdownRenderer's AST parse + reconcile — is what
  // React.memo on MarkdownBlock eliminates for completed blocks.
  const { blocks, tail } = useMemo(() => splitIntoBlocks(content), [content]);

  return (
    <>
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
    </>
  );
}

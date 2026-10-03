// ────────────────────────────────────────────────────────────────
// Block splitting for the streaming Markdown (D-88).
//
// Streamdown memoises one parse per top-level block, so a new token re-parses
// only the tail. But its splitter gives up — one block for the whole answer —
// as soon as the text contains anything shaped like a footnote, `[^label]`,
// and it looks inside code to decide: every regex character class such as
// `[^a-z0-9]` in a fenced block qualified. A long answer with one such line
// was re-parsed in full on every frame (the main source of long tasks while a
// big report streamed). Here code is masked first, so only real footnotes and
// link reference definitions — which do resolve across blocks — keep a
// document whole.
// ────────────────────────────────────────────────────────────────

import { parseMarkdownIntoBlocks } from 'streamdown';

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;

/** Same-length copy of `markdown` with `[` and `^` inside fenced and inline code replaced, so code cannot look like a footnote. */
export function maskCode(markdown: string): string {
  const neutral = (code: string) => code.replace(/[[\]^]/g, 'x');
  const lines = markdown.split('\n');
  let fence: { char: string; length: number } | null = null;
  let prose: string[] = [];
  const out: string[] = [];
  const flushProse = () => {
    if (prose.length === 0) return;
    out.push(prose.join('\n').replace(INLINE_CODE, (span) => neutral(span)));
    prose = [];
  };
  for (const line of lines) {
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence.char === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
      if (close.test(line)) fence = null;
      out.push(neutral(line));
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      flushProse();
      fence = { char: open[1]![0]!, length: open[1]!.length };
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  flushProse();
  return out.join('\n');
}

/** Constructs that resolve across blocks (outside code): footnotes and link reference definitions. */
const WHOLE_DOCUMENT = /^ {0,3}\[[^\]\n]+\]:\s|\[\^[\w-]{1,200}\]/m;

/** True when `markdown` must be parsed as one document (real footnotes or link reference definitions). */
export function needsWholeDocument(markdown: string): boolean {
  return WHOLE_DOCUMENT.test(maskCode(markdown));
}

/**
 * Top-level blocks of `markdown`, as slices of the original text. Code is
 * masked before Streamdown's splitter runs, so a `[^…]` inside code no longer
 * collapses the answer into one block.
 */
export function splitMarkdownBlocks(markdown: string): string[] {
  if (needsWholeDocument(markdown)) return [markdown];
  const masked = maskCode(markdown);
  const pieces = parseMarkdownIntoBlocks(masked);
  // Map the masked blocks back onto the original text (the mask keeps every length).
  let at = 0;
  const blocks: string[] = [];
  for (const piece of pieces) {
    blocks.push(markdown.slice(at, at + piece.length));
    at += piece.length;
  }
  return at === markdown.length ? blocks : parseMarkdownIntoBlocks(markdown);
}

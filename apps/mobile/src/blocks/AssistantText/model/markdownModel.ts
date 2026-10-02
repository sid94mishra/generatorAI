// ────────────────────────────────────────────────────────────────
// Markdown model — `marked` lexer → render tree.
//
// `Markdown.tsx` used to walk `marked`'s token tree directly inside JSX.
// That put every rendering decision (what a list item contains, how a table
// cell aligns, whether a link may open) inside a React Native component,
// where nothing could test it without a device.
//
// This module is the pure half: it turns markdown source into a small,
// explicit tree of nodes the renderer only has to map one-to-one. It has no
// React Native import, so the whole GFM surface — nested lists, task items,
// tables, images, link policy, the streaming auto-close — is unit-tested
// under node.
//
// The tree deliberately mirrors what the agent emits rather than the full
// CommonMark AST: anything unrecognised becomes a `raw` node and renders as
// its source text. An unknown construct should look plain, never disappear.
// ────────────────────────────────────────────────────────────────

import { marked, type Token, type Tokens } from 'marked';

import { classifyImage, classifyLink } from './linkPolicy';

// ── Node types ──────────────────────────────────────────────────

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; allowed: boolean; scheme: string | null; children: InlineNode[] }
  | { type: 'image'; src: string; alt: string; allowed: boolean }
  | { type: 'br' };

export type ColumnAlign = 'left' | 'center' | 'right' | null;

export interface ListItemNode {
  task: boolean;
  checked: boolean;
  children: BlockNode[];
}

export type BlockNode =
  | { type: 'heading'; depth: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[]; tight?: boolean }
  | { type: 'code'; code: string; lang: string | null; meta: string | null }
  | { type: 'list'; ordered: boolean; start: number; items: ListItemNode[] }
  | { type: 'blockquote'; children: BlockNode[] }
  | {
      type: 'table';
      align: ColumnAlign[];
      header: InlineNode[][];
      rows: InlineNode[][][];
      /** Estimated column widths in points; see `estimateColumnWidths`. */
      widths: number[];
    }
  | { type: 'hr' }
  | { type: 'image'; src: string; alt: string; allowed: boolean }
  | { type: 'raw'; text: string };

export interface ParseOptions {
  /**
   * The block is still arriving. Unterminated inline emphasis and code spans
   * are closed so the in-flight block never flashes raw `**` markers, and the
   * renderer skips work (image sizing, highlighting) that would be thrown
   * away on the next chunk.
   */
  streaming?: boolean;
}

// ── Entities ────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  copy: '©',
  reg: '®',
  trade: '™',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
};

/**
 * `marked` leaves entities in `text` tokens exactly as written, because its
 * own renderer emits HTML where they are already correct. A native `Text`
 * would show `&amp;` literally, so decode the handful that occur in prose.
 * Unknown entities are left alone — showing `&foo;` is better than eating it.
 */
export function decodeEntities(text: string): string {
  if (text.indexOf('&') === -1) return text;
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// ── Streaming auto-close ────────────────────────────────────────

/**
 * Whether the source ends inside an open fenced code block.
 *
 * `marked` already lexes an unterminated fence as a code block (verified
 * against 15.0.12), so nothing needs appending — but the inline closer below
 * must not run on it, or it would append `**` inside the code.
 */
export function endsInsideFence(src: string): boolean {
  let open: string | null = null;
  for (const line of src.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!m) continue;
    const fence = m[1]!;
    if (open === null) open = fence;
    else if (fence[0] === open[0] && fence.length >= open.length && line.trim() === fence) open = null;
  }
  return open !== null;
}

/**
 * Append closers for unterminated inline constructs in the in-flight
 * paragraph, so a chunk that ends mid-`**bold` renders bold rather than
 * showing the asterisks for a frame.
 *
 * Only the tail after the last blank line is inspected: emphasis never
 * crosses a paragraph boundary, so earlier paragraphs are already whatever
 * they will be. Inside an open fence nothing is appended (see above).
 *
 * The delimiter rules are a deliberate simplification of CommonMark's
 * flanking rules — an opener must be followed by non-space, a closer must be
 * preceded by non-space — which is enough for prose and code, and errs on
 * the side of NOT closing (a stray `*` in `2 * 3` is left alone).
 */
export function closeUnterminated(src: string): string {
  if (src.length === 0 || endsInsideFence(src)) return src;

  const lastBreak = src.lastIndexOf('\n\n');
  const tail = lastBreak === -1 ? src : src.slice(lastBreak + 2);
  // A table or heading tail is single-line by construction; the scan is
  // harmless there. An indented code block (4 spaces) is literal.
  if (/^ {4}/.test(tail)) return src;

  const stack: string[] = [];
  let i = 0;
  const n = tail.length;
  const at = (k: number): string => (k >= 0 && k < n ? tail[k]! : '');
  const isSpace = (c: string): boolean => c === '' || /\s/.test(c);

  while (i < n) {
    const c = tail[i]!;

    if (c === '\\') {
      i += 2;
      continue;
    }

    if (c === '`') {
      let run = 1;
      while (at(i + run) === '`') run += 1;
      const opener = '`'.repeat(run);
      const close = tail.indexOf(opener, i + run);
      if (close === -1) {
        // Everything after an unclosed backtick run is code: nothing inside
        // it can open emphasis, so close the span and stop.
        stack.push(opener);
        return src + stack.reverse().join('');
      }
      i = close + run;
      continue;
    }

    if (c === '*' || c === '_' || c === '~') {
      let run = 1;
      while (at(i + run) === c) run += 1;
      const prev = at(i - 1);
      const next = at(i + run);
      const canOpen = !isSpace(next) && (c !== '_' || !/[\w]/.test(prev));
      const canClose = !isSpace(prev) && (c !== '_' || !/[\w]/.test(next));

      let remaining = run;
      // `~` only means strike-through as a pair; single tildes are prose.
      if (c === '~') {
        if (run >= 2) {
          const delim = '~~';
          if (stack[stack.length - 1] === delim && canClose) stack.pop();
          else if (canOpen) stack.push(delim);
        }
        i += run;
        continue;
      }

      // Split a run into `**` and `*` units, matching innermost-first.
      while (remaining > 0) {
        const width = remaining >= 2 ? 2 : 1;
        const delim = c.repeat(width);
        const top = stack[stack.length - 1];
        if (top === delim && canClose) stack.pop();
        else if (canOpen) stack.push(delim);
        remaining -= width;
      }
      i += run;
      continue;
    }

    i += 1;
  }

  if (stack.length === 0) return src;
  return src + stack.reverse().join('');
}

// ── Tables ──────────────────────────────────────────────────────

/** Plain text of an inline subtree; used for width estimates and a11y. */
export function inlineText(nodes: InlineNode[]): string {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
        out += node.text;
        break;
      case 'image':
        out += node.alt;
        break;
      case 'br':
        out += '\n';
        break;
      default:
        out += inlineText(node.children);
    }
  }
  return out;
}

export const TABLE_COLUMN_MIN = 72;
export const TABLE_COLUMN_MAX = 260;
/** Average glyph width of the 12pt body face, in points, plus cell padding. */
const TABLE_GLYPH_WIDTH = 6.6;
const TABLE_CELL_PADDING = 24;

/**
 * Estimate a fixed width per column from the longest cell in it.
 *
 * React Native has no table layout: each row is its own flex row, so columns
 * only line up if every cell in a column is given the same width. Measuring
 * would need a render pass per cell; a glyph-count estimate is deterministic,
 * costs nothing, and is right within a few points for the body face. A cell
 * longer than the cap wraps inside its column rather than widening it.
 */
export function estimateColumnWidths(header: InlineNode[][], rows: InlineNode[][][]): number[] {
  const columns = Math.max(header.length, ...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < columns; c += 1) {
    let longest = inlineText(header[c] ?? []).length;
    for (const row of rows) {
      const len = inlineText(row[c] ?? []).length;
      if (len > longest) longest = len;
    }
    const raw = TABLE_CELL_PADDING + longest * TABLE_GLYPH_WIDTH;
    widths.push(Math.round(Math.min(TABLE_COLUMN_MAX, Math.max(TABLE_COLUMN_MIN, raw))));
  }
  return widths;
}

// ── Code fence info ─────────────────────────────────────────────

/**
 * `marked` hands over the whole info string as `lang` (`ts src/app.ts`).
 * The first word is the language; the rest is the filename / title the web
 * renderer shows next to it.
 */
export function splitFenceInfo(info: string | undefined): { lang: string | null; meta: string | null } {
  const trimmed = (info ?? '').trim();
  if (!trimmed) return { lang: null, meta: null };
  const space = trimmed.search(/\s/);
  if (space === -1) return { lang: trimmed.toLowerCase(), meta: null };
  return { lang: trimmed.slice(0, space).toLowerCase(), meta: trimmed.slice(space).trim() || null };
}

// ── Token → node ────────────────────────────────────────────────

function inlineNodes(tokens: Token[] | undefined): InlineNode[] {
  const out: InlineNode[] = [];
  if (!tokens) return out;
  const push = (node: InlineNode): void => {
    // Merge adjacent text so a paragraph is one span, not twenty.
    const last = out[out.length - 1];
    if (node.type === 'text' && last?.type === 'text') {
      out[out.length - 1] = { type: 'text', text: last.text + node.text };
    } else {
      out.push(node);
    }
  };
  for (const token of tokens) {
    // A block-level `text` token (a tight list item) carries its own inline
    // tokens; flatten them so the item reads as one run of spans.
    const nested = token.type === 'text' ? (token as Tokens.Text).tokens : undefined;
    if (nested && nested.length > 0) {
      for (const child of inlineNodes(nested)) push(child);
      continue;
    }
    const node = inlineNode(token);
    if (node !== null) push(node);
  }
  return out;
}

/** A soft line break inside a paragraph renders as a space, as on the web. */
function prose(text: string): string {
  return decodeEntities(text).replace(/\n/g, ' ');
}

function inlineNode(token: Token): InlineNode | null {
  switch (token.type) {
    case 'text':
      return { type: 'text', text: prose((token as Tokens.Text).text) };
    case 'escape':
      return { type: 'text', text: (token as Tokens.Escape).text };
    case 'strong':
      return { type: 'strong', children: inlineNodes((token as Tokens.Strong).tokens) };
    case 'em':
      return { type: 'em', children: inlineNodes((token as Tokens.Em).tokens) };
    case 'del':
      return { type: 'del', children: inlineNodes((token as Tokens.Del).tokens) };
    case 'codespan':
      return { type: 'code', text: decodeEntities((token as Tokens.Codespan).text) };
    case 'br':
      return { type: 'br' };
    case 'link': {
      const t = token as Tokens.Link;
      const decision = classifyLink(t.href);
      const children = inlineNodes(t.tokens);
      return {
        type: 'link',
        href: decision.href,
        allowed: decision.allowed,
        scheme: decision.scheme,
        children: children.length > 0 ? children : [{ type: 'text', text: decision.href }],
      };
    }
    case 'image': {
      const t = token as Tokens.Image;
      const decision = classifyImage(t.href);
      return { type: 'image', src: decision.href, alt: decodeEntities(t.text ?? ''), allowed: decision.allowed };
    }
    case 'html':
      // Inline HTML the model wrote (`<br>`, `<kbd>`) is shown as-is: an
      // unrecognised construct looks plain rather than vanishing.
      return { type: 'text', text: (token as Tokens.HTML).raw };
    default: {
      const raw = (token as { raw?: string }).raw;
      return raw ? { type: 'text', text: raw } : null;
    }
  }
}

function blockNodes(tokens: Token[] | undefined, tight = false): BlockNode[] {
  const out: BlockNode[] = [];
  if (!tokens) return out;
  for (const token of tokens) {
    const node = blockNode(token, tight);
    if (node !== null) out.push(node);
  }
  return out;
}

/**
 * A paragraph that is nothing but one image is a block image: it gets its
 * own row and aspect-ratio box rather than being squeezed into a text line.
 */
function imageOnly(children: InlineNode[]): Extract<InlineNode, { type: 'image' }> | null {
  const meaningful = children.filter((c) => !(c.type === 'text' && c.text.trim() === ''));
  const only = meaningful.length === 1 ? meaningful[0]! : null;
  return only?.type === 'image' ? only : null;
}

function blockNode(token: Token, tight: boolean): BlockNode | null {
  switch (token.type) {
    case 'heading': {
      const t = token as Tokens.Heading;
      const depth = Math.min(6, Math.max(1, t.depth)) as 1 | 2 | 3 | 4 | 5 | 6;
      return { type: 'heading', depth, children: inlineNodes(t.tokens) };
    }
    case 'paragraph':
    case 'text': {
      const children = inlineNodes((token as Tokens.Paragraph).tokens);
      const image = imageOnly(children);
      if (image) return { type: 'image', src: image.src, alt: image.alt, allowed: image.allowed };
      return tight ? { type: 'paragraph', children, tight: true } : { type: 'paragraph', children };
    }
    case 'code': {
      const t = token as Tokens.Code;
      const { lang, meta } = splitFenceInfo(t.lang);
      return { type: 'code', code: t.text, lang, meta };
    }
    case 'list': {
      const t = token as Tokens.List;
      const start = typeof t.start === 'number' ? t.start : 1;
      return {
        type: 'list',
        ordered: Boolean(t.ordered),
        start,
        items: t.items.map((item) => ({
          task: Boolean(item.task),
          checked: Boolean(item.checked),
          children: blockNodes(item.tokens, !item.loose),
        })),
      };
    }
    case 'blockquote':
      return { type: 'blockquote', children: blockNodes((token as Tokens.Blockquote).tokens) };
    case 'table': {
      const t = token as Tokens.Table;
      const header = t.header.map((cell) => inlineNodes(cell.tokens));
      const rows = t.rows.map((row) => row.map((cell) => inlineNodes(cell.tokens)));
      return {
        type: 'table',
        align: t.align.map((a) => a ?? null),
        header,
        rows,
        widths: estimateColumnWidths(header, rows),
      };
    }
    case 'hr':
      return { type: 'hr' };
    case 'space':
    case 'def':
      return null;
    case 'html':
      return { type: 'raw', text: (token as Tokens.HTML).raw.replace(/\n+$/, '') };
    default: {
      const raw = (token as { raw?: string }).raw;
      return raw ? { type: 'raw', text: raw } : null;
    }
  }
}

// ── Entry point ─────────────────────────────────────────────────

/** Bounded memo: a settled block re-mounts when the list recycles its row. */
const PARSE_CACHE_MAX = 32;
const parseCache = new Map<string, BlockNode[]>();

/**
 * Parse markdown into the render tree.
 *
 * Cached on the *effective* source — after the streaming closer has run — so
 * the final in-flight chunk and the settled block that replaces it share one
 * parse when nothing needed closing, which is the common case.
 */
export function parseMarkdown(content: string, options: ParseOptions = {}): BlockNode[] {
  const source = options.streaming ? closeUnterminated(content) : content;
  const cached = parseCache.get(source);
  if (cached) return cached;

  let tree: BlockNode[];
  try {
    tree = blockNodes(marked.lexer(source));
  } catch {
    // Malformed markdown must render as text, not crash the transcript.
    tree = [{ type: 'paragraph', children: [{ type: 'text', text: content }] }];
  }

  if (parseCache.size >= PARSE_CACHE_MAX) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) parseCache.delete(oldest);
  }
  parseCache.set(source, tree);
  return tree;
}

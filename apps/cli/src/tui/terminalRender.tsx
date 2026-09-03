// ────────────────────────────────────────────────────────────────
// Rendering a terminal pane's scrollback as an actual terminal, not a
// syntax-highlighted text dump (Phase 5 item 3).
//
// `TerminalPane` used to hand `state.scrollback` — raw PTY bytes, ANSI
// escapes and all — straight to `CodeBlock`, a syntax highlighter with no
// SGR/cursor-movement handling at all. Any colored `ls`, vim, or htop
// rendered as literal escape-code garbage. This feeds the same text through
// a real (headless) terminal emulator and walks its cell buffer instead.
//
// `@xterm/headless` has no production consumer anywhere else in this repo —
// only `apps/cli/src/__tests__/tui-e2e.test.tsx` uses it, to assert against
// rendered ANSI output in tests. That test also establishes the only import
// shape that actually works for this package under this repo's ESM/CJS
// interop (`@xterm/headless` ships no `exports` field and no static named
// exports a bundler/cjs-module-lexer can see through, so a real
// `import { Terminal } from '@xterm/headless'` resolves to `undefined` at
// runtime here) — followed exactly below rather than re-discovering it.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import xterm from '@xterm/headless';
import type { IBufferCell, Terminal as XtermTerminal } from '@xterm/headless';

const Terminal = (xterm as unknown as { Terminal: typeof XtermTerminal }).Terminal;

export interface TerminalSpan {
  text: string;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  dimColor?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

export type TerminalLine = TerminalSpan[];

/** A single space with no styling — what an untouched/fully-default cell renders as. */
const BLANK_SPAN: TerminalSpan = { text: ' ' };

function fgProp(cell: IBufferCell): string | undefined {
  if (cell.isFgDefault()) return undefined;
  if (cell.isFgPalette()) return `ansi256(${cell.getFgColor()})`;
  if (cell.isFgRGB()) return `#${cell.getFgColor().toString(16).padStart(6, '0')}`;
  return undefined;
}

function bgProp(cell: IBufferCell): string | undefined {
  if (cell.isBgDefault()) return undefined;
  if (cell.isBgPalette()) return `ansi256(${cell.getBgColor()})`;
  if (cell.isBgRGB()) return `#${cell.getBgColor().toString(16).padStart(6, '0')}`;
  return undefined;
}

function spanFor(cell: IBufferCell): TerminalSpan {
  // VT100 "invisible" (CSI 8 m) hides the glyph, not the cell's styling —
  // e.g. a colored block drawn with invisible spaces. Substituting blanks
  // for the characters (not for the span entirely) preserves that.
  const chars = cell.isInvisible() ? ' '.repeat(Math.max(1, cell.getWidth())) : cell.getChars() || ' ';
  const span: TerminalSpan = { text: chars };
  const fg = fgProp(cell);
  const bg = bgProp(cell);
  if (fg) span.color = fg;
  if (bg) span.backgroundColor = bg;
  if (cell.isBold()) span.bold = true;
  if (cell.isItalic()) span.italic = true;
  if (cell.isDim()) span.dimColor = true;
  if (cell.isUnderline()) span.underline = true;
  // Ink's own `inverse` prop already swaps fg/bg for rendering — no need to
  // resolve the swap ourselves.
  if (cell.isInverse()) span.inverse = true;
  if (cell.isStrikethrough()) span.strikethrough = true;
  return span;
}

function sameStyle(a: TerminalSpan, b: TerminalSpan): boolean {
  return (
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.dimColor === b.dimColor &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    a.strikethrough === b.strikethrough
  );
}

function isUnstyled(span: TerminalSpan): boolean {
  return (
    !span.color &&
    !span.backgroundColor &&
    !span.bold &&
    !span.italic &&
    !span.dimColor &&
    !span.underline &&
    !span.inverse &&
    !span.strikethrough
  );
}

/**
 * Walks a headless terminal's active buffer into styled spans, one run per
 * line, coalescing adjacent same-styled cells so a plain line of text stays
 * one `<Text>` node instead of one per character.
 *
 * Pure and independently testable: build a `Terminal`, `write()` into it
 * with a callback (writes are not guaranteed synchronous — see
 * `useTerminalScreen` below), then call this once the callback fires.
 */
export function bufferToLines(term: XtermTerminal, firstRow?: number): TerminalLine[] {
  const buffer = term.buffer.active;
  const lines: TerminalLine[] = [];
  // `firstRow` is an absolute row in the buffer, which INCLUDES scrollback
  // (open question #10). Omitted, it means the viewport — which is what
  // every caller wanted before terminal panes could scroll at all.
  const start = firstRow ?? buffer.baseY;
  for (let y = start; y < start + term.rows; y++) {
    const line = buffer.getLine(y);
    const spans: TerminalLine = [];
    if (line) {
      for (let x = 0; x < line.length; x++) {
        const cell = line.getCell(x);
        // Width-0 cells are the trailing half of the wide character before
        // them (CJK, emoji) — their own `getChars()` is empty; skip rather
        // than push a no-op span.
        if (!cell || cell.getWidth() === 0) continue;
        const span = spanFor(cell);
        const last = spans[spans.length - 1];
        if (last && sameStyle(last, span)) {
          last.text += span.text;
        } else {
          spans.push(span);
        }
      }
    }
    // Trim trailing padding (untouched cells past whatever was actually
    // printed) — xterm pads every line to the full column width, and
    // rendering that padding would just be columns of pointless trailing
    // spaces with no visual difference. Only the LAST span can carry this
    // padding (an untouched cell is unstyled, same as plain text, so it
    // coalesced into whatever unstyled span preceded it rather than
    // starting its own) — trimming its text, not discarding the whole
    // span, is what keeps real content that happened to share that span
    // (e.g. "hello world" immediately followed by untouched cells). A
    // trailing run that carries real styling (a colored background
    // painted to end-of-line) is its own, styled span and is never
    // touched here.
    const lastSpan = spans[spans.length - 1];
    if (lastSpan && isUnstyled(lastSpan)) {
      lastSpan.text = lastSpan.text.replace(/\s+$/, '');
      if (lastSpan.text === '') spans.pop();
    }
    lines.push(spans.length > 0 ? spans : [BLANK_SPAN]);
  }
  return lines;
}

/**
 * Feeds `text` through a fresh headless terminal sized to `cols`x`rows` and
 * returns the resulting screen as styled lines.
 *
 * `Terminal.write()` is not guaranteed to finish synchronously (xterm.js
 * time-boxes large writes and continues them on a later microtask) — so this
 * cannot be a plain synchronous helper called mid-render. It runs the write
 * in an effect and reports the result back through state once the callback
 * fires, same shape as any other async-derived render data in this app.
 *
 * A fresh `Terminal` per call, disposed once its callback lands (or on
 * cleanup if the effect re-ran or unmounted first) — simpler and safer than
 * trying to `reset()` and reuse one instance across renders, and the
 * scrollback fetch that feeds `text` already happens far less often than a
 * typical Ink re-render.
 */
export interface TerminalScreenState {
  lines: TerminalLine[];
  /** How many rows of scrollback sit above the current window. */
  scrollbackDepth: number;
}

export function useTerminalScreen(
  text: string,
  cols: number,
  rows: number,
  scrollBack = 0,
): TerminalScreenState {
  const [state, setState] = useState<TerminalScreenState>({ lines: [], scrollbackDepth: 0 });
  const disposedRef = useRef(false);

  useEffect(() => {
    if (!text) {
      setState({ lines: [], scrollbackDepth: 0 });
      return;
    }
    disposedRef.current = false;
    // A real scrollback buffer now, not `0`: paging needs rows that have
    // left the viewport to still exist. 5000 matches the retention bound the
    // rest of this app uses for the same reason — bounded, and far more
    // than anyone scrolls back through by hand.
    const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true });
    term.write(text, () => {
      if (disposedRef.current) return;
      const depth = term.buffer.active.baseY;
      const first = Math.max(0, depth - Math.max(0, scrollBack));
      setState({ lines: bufferToLines(term, first), scrollbackDepth: depth });
      disposedRef.current = true;
      term.dispose();
    });
    return () => {
      if (disposedRef.current) return;
      disposedRef.current = true;
      term.dispose();
    };
  }, [text, cols, rows, scrollBack]);

  return state;
}

/** Renders the lines `useTerminalScreen` produced. */
export function TerminalScreen({ lines }: { lines: TerminalLine[] }): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {lines.map((spans, i) => (
        <Text key={i} wrap="truncate-end">
          {spans.map((span, j) => (
            <Text
              key={j}
              {...(span.color ? { color: span.color } : {})}
              {...(span.backgroundColor ? { backgroundColor: span.backgroundColor } : {})}
              {...(span.bold ? { bold: true } : {})}
              {...(span.italic ? { italic: true } : {})}
              {...(span.dimColor ? { dimColor: true } : {})}
              {...(span.underline ? { underline: true } : {})}
              {...(span.inverse ? { inverse: true } : {})}
              {...(span.strikethrough ? { strikethrough: true } : {})}
            >
              {span.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

/**
 * Finds a case-insensitive match in a terminal's FULL buffer, scrollback
 * included, and returns the `scrollBack` offset that brings it into view
 * (open question #10).
 *
 * Done through a real headless terminal rather than by searching the raw
 * bytes: the raw text is full of SGR escapes and its line breaks are not the
 * rendered ones, so a match index in it maps to no particular row on screen.
 * Feeding it through the same emulator the pane renders with is the only way
 * the answer refers to what the user is actually looking at.
 *
 * Searches strictly OLDER than `afterScrollBack` first, then wraps — the
 * same "keep going, then wrap" convention `findTranscriptMatch` uses for
 * chat, so repeated presses walk back through matches one at a time.
 */
export async function findTerminalMatch(
  text: string,
  cols: number,
  rows: number,
  query: string,
  afterScrollBack = -1,
): Promise<number | null> {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return null;

  return new Promise<number | null>((resolve) => {
    const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true });
    term.write(text, () => {
      const buffer = term.buffer.active;
      const rowText = (y: number): string =>
        (buffer.getLine(y)?.translateToString(true) ?? '').toLowerCase();

      // `scrollBack` counts rows ABOVE the live tail, so a bigger offset is
      // an older row: "older than where we are" means a SMALLER buffer index.
      const current = buffer.baseY - Math.max(0, afterScrollBack);
      let found: number | null = null;
      for (let y = Math.min(current - 1, buffer.baseY); y >= 0 && found === null; y--) {
        if (rowText(y).includes(needle)) found = buffer.baseY - y;
      }
      for (let y = buffer.baseY; y > current - 1 && found === null; y--) {
        if (y >= 0 && rowText(y).includes(needle)) found = buffer.baseY - y;
      }
      term.dispose();
      resolve(found);
    });
  });
}

/**
 * The plain text of what a terminal pane is showing, at a given scrollback
 * offset (open question #11).
 *
 * Same emulator, same window, so "copy" copies exactly what is on screen —
 * copying the raw byte stream instead would hand the user SGR escapes and
 * rows that scrolled past long ago.
 */
export async function renderTerminalText(
  text: string,
  cols: number,
  rows: number,
  scrollBack = 0,
): Promise<string> {
  if (!text) return '';
  return new Promise<string>((resolve) => {
    const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true });
    term.write(text, () => {
      const first = Math.max(0, term.buffer.active.baseY - Math.max(0, scrollBack));
      const lines = bufferToLines(term, first)
        .map((spans) => spans.map((span) => span.text).join('').replace(/\s+$/, ''));
      term.dispose();
      // Trailing blank rows are the emulator padding the viewport, not
      // content — pasting them appends a block of empty lines.
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      resolve(lines.join('\n'));
    });
  });
}

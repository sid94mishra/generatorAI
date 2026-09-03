import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import xterm from '@xterm/headless';
import type { Terminal as XtermTerminal } from '@xterm/headless';
import { bufferToLines, TerminalScreen, useTerminalScreen } from '../terminalRender.js';

// Same import workaround `tui-e2e.test.tsx` already established: this
// package ships no static named exports a bundler can see through, so a
// direct `import { Terminal } from '@xterm/headless'` resolves to `undefined`
// at runtime under this repo's ESM/CJS interop.
const Terminal = (xterm as unknown as { Terminal: typeof XtermTerminal }).Terminal;

function makeTerminal(cols: number, rows: number): XtermTerminal {
  return new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
}

/** `Terminal.write()` is not guaranteed synchronous — always go through the callback. */
async function write(term: XtermTerminal, text: string): Promise<void> {
  await new Promise<void>((resolve) => term.write(text, () => resolve()));
}

describe('bufferToLines', () => {
  it('renders plain text as one unstyled span per line, and pads untouched lines to a single blank span', async () => {
    const term = makeTerminal(20, 3);
    await write(term, 'hello world');
    const lines = bufferToLines(term);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual([{ text: 'hello world' }]);
    // Not an empty array — an empty array would collapse to zero height in
    // Ink's Box (the same Yoga quirk this file's `ChatPane` already works
    // around for its own pinned indicator).
    expect(lines[1]).toEqual([{ text: ' ' }]);
    expect(lines[2]).toEqual([{ text: ' ' }]);
    term.dispose();
  });

  it('splits a line into styled spans exactly at the SGR boundary', async () => {
    const term = makeTerminal(20, 1);
    await write(term, 'plain\x1b[31mred\x1b[0mplain');
    const lines = bufferToLines(term);
    expect(lines[0]).toEqual([
      { text: 'plain' },
      { text: 'red', color: 'ansi256(1)' },
      { text: 'plain' },
    ]);
    term.dispose();
  });

  it('maps a true-color (RGB) SGR sequence to a hex color', async () => {
    const term = makeTerminal(20, 1);
    await write(term, '\x1b[38;2;255;0;0mred\x1b[0m');
    const lines = bufferToLines(term);
    expect(lines[0]).toEqual([{ text: 'red', color: '#ff0000' }]);
    term.dispose();
  });

  it('maps a background color the same way as foreground', async () => {
    const term = makeTerminal(20, 1);
    await write(term, '\x1b[44mblue-bg\x1b[0m');
    const lines = bufferToLines(term);
    expect(lines[0]).toEqual([{ text: 'blue-bg', backgroundColor: 'ansi256(4)' }]);
    term.dispose();
  });

  it('maps bold, italic, dim, underline, inverse and strikethrough onto Ink Text props', async () => {
    const term = makeTerminal(20, 1);
    await write(term, '\x1b[1;3;2;4;7;9mstyled\x1b[0m');
    const lines = bufferToLines(term);
    expect(lines[0]).toEqual([
      {
        text: 'styled',
        bold: true,
        italic: true,
        dimColor: true,
        underline: true,
        inverse: true,
        strikethrough: true,
      },
    ]);
    term.dispose();
  });

  it('renders invisible text as blank spaces, keeping any styling', async () => {
    const term = makeTerminal(20, 1);
    await write(term, '\x1b[8;41msecret\x1b[0m');
    const lines = bufferToLines(term);
    expect(lines[0]).toEqual([{ text: '      ', backgroundColor: 'ansi256(1)' }]);
    term.dispose();
  });

  it('renders a multi-line buffer line-by-line, in order', async () => {
    const term = makeTerminal(20, 3);
    await write(term, 'one\r\ntwo\r\nthree');
    const lines = bufferToLines(term);
    expect(lines).toEqual([[{ text: 'one' }], [{ text: 'two' }], [{ text: 'three' }]]);
    term.dispose();
  });

  it('shows only the tail once content exceeds the viewport, not a crash or a wrapped mess', async () => {
    const term = makeTerminal(20, 2);
    await write(term, 'one\r\ntwo\r\nthree\r\nfour');
    const lines = bufferToLines(term);
    // The viewport tracks the bottom, the same way a real terminal does —
    // this is what lets the renderer skip pre-truncating the input text
    // (see `TerminalPane`'s own comment on why that would be unsafe with
    // ANSI escapes in play).
    expect(lines).toEqual([[{ text: 'three' }], [{ text: 'four' }]]);
    term.dispose();
  });

  it('keeps a trailing styled run (e.g. a background painted to end-of-line) instead of trimming it away', async () => {
    const term = makeTerminal(10, 1);
    await write(term, 'hi\x1b[44m      \x1b[0m'); // "hi" + 6 blue-background spaces
    const lines = bufferToLines(term);
    expect(lines[0]).toEqual([
      { text: 'hi' },
      { text: '      ', backgroundColor: 'ansi256(4)' },
    ]);
    term.dispose();
  });

  it('skips the filler cell after a wide character instead of emitting an empty span', async () => {
    const term = makeTerminal(10, 1);
    await write(term, '中x'); // CJK wide char (2 cols) + narrow char
    const lines = bufferToLines(term);
    expect(lines[0]).toEqual([{ text: '中x' }]);
    term.dispose();
  });
});

// ── React-level wiring (the async write → state → re-render path) ──

function Harness({
  text,
  cols,
  rows,
  scrollBack = 0,
}: {
  text: string;
  cols: number;
  rows: number;
  scrollBack?: number;
}): React.JSX.Element {
  // The hook returns the window PLUS how much scrollback sits above it
  // (open question #10) — a pane needs the depth to say "↑ N rows back".
  const { lines } = useTerminalScreen(text, cols, rows, scrollBack);
  return <TerminalScreen lines={lines} />;
}

describe('useTerminalScreen + TerminalScreen', () => {
  it('renders the written text once the async write settles', async () => {
    const instance = render(<Harness text={'hi\r\nthere'} cols={20} rows={2} />);
    await vi.waitFor(() => {
      expect(instance.lastFrame()).toContain('hi');
      expect(instance.lastFrame()).toContain('there');
    });
    instance.unmount();
  });

  it('does not crash or leak across a text/size change (reattach or resize)', async () => {
    const instance = render(<Harness text={'v1'} cols={10} rows={2} />);
    await vi.waitFor(() => expect(instance.lastFrame()).toContain('v1'));

    instance.rerender(<Harness text={'v2, now wider'} cols={30} rows={4} />);
    await vi.waitFor(() => expect(instance.lastFrame()).toContain('v2, now wider'));

    instance.unmount();
  });

  it('renders cleanly with no text (the empty-state fallback path in TerminalPane)', () => {
    const instance = render(<Harness text={''} cols={10} rows={2} />);
    expect(() => instance.lastFrame()).not.toThrow();
    instance.unmount();
  });
});

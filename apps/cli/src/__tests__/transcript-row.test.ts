import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import React from 'react';
import { render, Box } from 'ink';
import xterm from '@xterm/headless';
import { ThemeProvider } from '@generatorai/tui-kit';
import { TimelineRow } from '../tui/panes.js';

const Terminal = (xterm as unknown as { Terminal: typeof import('@xterm/headless').Terminal }).Terminal;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('transcript rows', () => {
  it('labels the user turn as well as the assistant turn', async () => {
    const columns = 80;
    const rows = 20;
    const term = new Terminal({ cols: columns, rows, allowProposedApi: true });
    const out = new PassThrough() as unknown as NodeJS.WriteStream;
    out.isTTY = true;
    out.columns = columns;
    out.rows = rows;
    (out as unknown as { getColorDepth: () => number }).getColorDepth = () => 24;
    (out as unknown as { hasColors: () => boolean }).hasColors = () => true;
    out.on('data', (c: Buffer) => term.write(String(c).replace(/\r?\n/g, '\r\n')));

    const items = [
      { id: 'a', kind: 'user' as const, text: 'what is a pipeline', complete: true, at: 1 },
      { id: 'b', kind: 'assistant' as const, text: 'it automates builds', complete: true, at: 2 },
    ];

    const instance = render(
      React.createElement(
        ThemeProvider,
        { capabilities: { isTTY: true, columns, rows, colorDepth: 'truecolor', unicode: true } as never },
        React.createElement(
          Box,
          { flexDirection: 'column' },
          ...items.map((item) =>
            React.createElement(TimelineRow, { key: item.id, item }),
          ),
        ),
      ),
      { stdout: out, patchConsole: false },
    );

    await delay(300);
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < rows; y++) {
      const line = buffer.getLine(y);
      lines.push(line ? line.translateToString(true) : '');
    }
    instance.unmount();
    const text = lines.join('\n');

    expect(text).toContain('assistant');
    expect(text).toContain('you');
  }, 20000);

  it('keeps the role labels when the transcript box is height-constrained', async () => {
    const columns = 80;
    const rows = 24;
    const term = new Terminal({ cols: columns, rows, allowProposedApi: true });
    const out = new PassThrough() as unknown as NodeJS.WriteStream;
    out.isTTY = true;
    out.columns = columns;
    out.rows = rows;
    (out as unknown as { getColorDepth: () => number }).getColorDepth = () => 24;
    (out as unknown as { hasColors: () => boolean }).hasColors = () => true;
    out.on('data', (c: Buffer) => term.write(String(c).replace(/\r?\n/g, '\r\n')));

    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `m${index}`,
      kind: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `message number ${index} `.repeat(3),
      complete: true,
      at: index,
    }));

    const instance = render(
      React.createElement(
        ThemeProvider,
        { capabilities: { isTTY: true, columns, rows, colorDepth: 'truecolor', unicode: true } as never },
        // The shape ChatPane uses: a fixed height with hidden overflow.
        React.createElement(
          Box,
          { flexDirection: 'column', height: 12, overflow: 'hidden' },
          ...items.map((item) =>
            React.createElement(TimelineRow, { key: item.id, item, maxLines: 3 }),
          ),
        ),
      ),
      { stdout: out, patchConsole: false },
    );

    await delay(300);
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < rows; y++) {
      const line = buffer.getLine(y);
      lines.push(line ? line.translateToString(true) : '');
    }
    instance.unmount();
    const text = lines.join('\n');

    // Every visible turn must say who is speaking. Losing the label is what
    // makes a transcript read as one run-on block.
    const labels = lines.filter((l) => /^\s*(you|assistant)\s*$/.test(l)).length;
    expect(labels).toBeGreaterThanOrEqual(3);
    expect(text).toContain('you');
  }, 20000);
});

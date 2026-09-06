// The workbench refuses to start below 60 columns (launch.tsx), so 60–99 is
// the range where a fixed-proportion split can first run out of room. Nothing
// in panes.tsx branches on width there, which is exactly why a frame audit —
// not a unit test — is the only thing that can catch a row painting past the
// last column. Same harness shape as `__tests__/tui-sweep.test.ts`, run at
// the three widths that bracket the range.

import { afterAll, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import stringWidth from 'string-width';
import xterm from '@xterm/headless';
import type { Terminal as XtermTerminal } from '@xterm/headless';
import { buildRegistry, DEFAULT_KEYMAP, detectTerminal, loadConfig } from '@generatorai/cli-core';
import { Renderer } from '../../render/Renderer.js';
import { createLogger } from '../../logger.js';
import { launchTui } from '../launch.js';
import type { Session } from '../../session.js';

const Terminal = (xterm as unknown as { Terminal: typeof XtermTerminal }).Terminal;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Harness {
  send: (bytes: string) => void;
  frame: () => string[];
  stop: () => void;
}

async function boot(columns: number, rows: number): Promise<Harness> {
  const term = new Terminal({ cols: columns, rows, allowProposedApi: true });
  const out = new PassThrough() as unknown as NodeJS.WriteStream;
  out.isTTY = true;
  out.columns = columns;
  out.rows = rows;
  (out as unknown as { getColorDepth: () => number }).getColorDepth = () => 24;
  (out as unknown as { hasColors: () => boolean }).hasColors = () => true;
  out.on('data', (c: Buffer) => term.write(String(c).replace(/\r?\n/g, '\r\n')));

  const inp = new PassThrough() as unknown as NodeJS.ReadStream;
  inp.isTTY = true;
  inp.setRawMode = () => inp;
  (inp as unknown as { ref: () => unknown }).ref = () => inp;
  (inp as unknown as { unref: () => unknown }).unref = () => inp;

  const base = await loadConfig({ flags: {}, flagNames: [] });
  const capabilities = detectTerminal({
    stdout: { isTTY: true, columns, rows },
    overrides: { isTTY: true, columns, rows, colorDepth: 'truecolor', unicode: true },
  });
  const session: Session = {
    config: {
      ...base,
      // An unroutable port: the point is the frame, not the data, and a
      // refused connection is exactly the state the status bar must survive.
      server: { ...base.server, url: 'http://127.0.0.1:1' },
      tui: { ...base.tui, refreshMs: 0, restoreLayout: false },
    },
    capabilities,
    renderer: new Renderer({ mode: 'auto', color: false, unicode: true, stdout: out }),
    logger: createLogger({ verbose: false, capabilities, silentStderr: true }),
    outputMode: 'auto',
    dispose: async () => {},
  };

  const abort = new AbortController();
  void launchTui({
    session,
    flags: {},
    registry: buildRegistry({ version: 'narrow' }),
    restore: false,
    signal: abort.signal,
    stdout: out,
    stdin: inp,
  }).catch(() => {});

  await delay(2500);

  return {
    send: (bytes) => (inp as unknown as PassThrough).write(bytes),
    frame: () => {
      const b = term.buffer.active;
      const lines: string[] = [];
      for (let y = 0; y < rows; y++) {
        const line = b.getLine(b.viewportY + y);
        lines.push(line ? line.translateToString(true) : '');
      }
      return lines;
    },
    stop: () => abort.abort(),
  };
}

/** Rows wider than the terminal, plus boxes whose corners do not pair up. */
function audit(lines: string[], columns: number): string[] {
  const faults: string[] = [];
  for (const [index, line] of lines.entries()) {
    const trimmed = line.replace(/\s+$/, '');
    const width = stringWidth(trimmed);
    if (width > columns) faults.push(`row ${index} overflows: ${width} > ${columns}`);
    if (/�/.test(line)) faults.push(`row ${index} has a replacement character`);
  }
  const open = lines.filter((l) => /^\s*╭/.test(l)).length;
  const close = lines.filter((l) => /^\s*╰/.test(l)).length;
  if (open !== close) faults.push(`unbalanced boxes: ${open} open, ${close} closed`);
  if (!lines.some((l) => l.includes('GeneratorAI'))) faults.push('title bar missing');
  return faults;
}

// Read from the real keymap so a rebind cannot desync this test from the app.
const LEADER = DEFAULT_KEYMAP.find((b) => b.id === 'pane.leader')!.keys; // 'alt+l'
const SPLIT = DEFAULT_KEYMAP.find((b) => b.id === 'pane.splitVertical')!.keys; // '%'
if (LEADER !== 'alt+l') throw new Error(`update chordBytes(): leader is now ${LEADER}`);
const LEADER_BYTES = '\x1bl';

const running: Harness[] = [];
afterAll(async () => {
  for (const h of running) h.stop();
  await delay(300);
});

describe('TUI · narrow terminals (60–99 columns)', () => {
  for (const columns of [60, 79, 99]) {
    it(
      `paints inside ${columns} columns through the palette, help and a vertical split`,
      async () => {
        const rows = 24;
        const h = await boot(columns, rows);
        running.push(h);
        const problems: string[] = [];
        const check = (label: string) => {
          const faults = audit(h.frame(), columns);
          if (faults.length > 0) problems.push(`${label}: ${faults.join('; ')}`);
        };

        check('initial');
        h.send('g w'); // goto.workflows
        await delay(500);
        check('workflows list');
        h.send('\x0b'); // ctrl+k — app.palette
        await delay(500);
        check('palette');
        h.send('\x1b');
        await delay(200);
        h.send('?'); // app.help
        await delay(400);
        check('help');
        h.send('\x1b');
        await delay(200);
        // A vertical split is where a fixed proportion first starves a pane.
        h.send(LEADER_BYTES);
        await delay(100);
        h.send(SPLIT);
        await delay(500);
        check('vertical split');

        expect(problems).toEqual([]);
      },
      60_000,
    );
  }
});

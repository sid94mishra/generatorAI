// Drives every keymap binding through a real Ink render and audits each
// resulting frame. The assertions are about *frame integrity* — nothing may
// spill past the last column, borders must stay closed, and the status bar
// must survive — because those are the failures that make a TUI feel broken
// and the ones unit tests never catch.

import { describe, expect, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import xterm from '@xterm/headless';
import { buildRegistry, DEFAULT_KEYMAP, detectTerminal, loadConfig } from '@generatorai/cli-core';
import { Renderer } from '../render/Renderer.js';
import { createLogger } from '../logger.js';
import { launchTui } from '../tui/launch.js';
import type { Session } from '../session.js';

const Terminal = (xterm as unknown as { Terminal: typeof import('@xterm/headless').Terminal }).Terminal;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GALLERY = 'tui-sweep-gallery.txt';

/** Escape sequences for the named keys the keymap uses. */
const KEYS: Record<string, string> = {
  return: '\r',
  space: ' ',
  escape: '\x1b',
  tab: '\t',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
  backspace: '\x7f',
};

/** Turns a keymap chord ("ctrl+b", "g d", "alt+e") into bytes. */
function chordToBytes(chord: string): string {
  return chord
    .split(' ')
    .map((part) => {
      const segments = part.split('+');
      const key = segments.pop() ?? '';
      const ctrl = segments.includes('ctrl');
      const alt = segments.includes('alt') || segments.includes('meta');
      const shift = segments.includes('shift');
      let bytes = KEYS[key] ?? key;
      if (ctrl && /^[a-z_]$/i.test(key)) {
        bytes = String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
      }
      if (shift && /^[a-z]$/.test(key)) bytes = key.toUpperCase();
      if (alt) bytes = `\x1b${bytes}`;
      return bytes;
    })
    .join('');
}

interface Harness {
  send: (bytes: string) => void;
  frame: () => string[];
  stop: () => void;
  columns: number;
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
      server: { ...base.server, url: 'http://127.0.0.1:3100' },
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
    registry: buildRegistry({ version: 'sweep' }),
    restore: false,
    signal: abort.signal,
    stdout: out,
    stdin: inp,
  }).catch(() => {});

  await delay(3500);

  return {
    columns,
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

/** Structural faults that make a frame look broken to a human. */
function auditFrame(lines: string[], columns: number): string[] {
  const faults: string[] = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.replace(/\s+$/, '');
    if (trimmed.length > columns) {
      faults.push(`row ${index} overflows: ${trimmed.length} > ${columns} cols`);
    }
    // A box-drawing corner in the middle of a run of text means two elements
    // were painted onto the same cell.
    if (/[│┃][^│┃]*[╰╯╭╮][^│┃]*$/.test(trimmed) && !/^[\s]*[╰╯╭╮]/.test(trimmed)) {
      faults.push(`row ${index} has a border glyph inside a line: ${trimmed.slice(0, 60)}`);
    }
    if (/\uFFFD/.test(line)) faults.push(`row ${index} has a replacement character`);
  }

  const open = lines.filter((l) => /^\s*╭/.test(l)).length;
  const close = lines.filter((l) => /^\s*╰/.test(l)).length;
  if (open !== close) faults.push(`unbalanced boxes: ${open} open, ${close} closed`);

  if (!lines.some((l) => l.includes('GeneratorAI'))) faults.push('title bar missing');

  return faults;
}

describe('TUI · full command sweep', () => {
  it('drives every binding without corrupting a frame', async () => {
    const columns = 120;
    const rows = 36;
    const h = await boot(columns, rows);
    writeFileSync(GALLERY, `TUI sweep · ${columns}x${rows}\n`);

    const problems: string[] = [];

    const step = async (label: string, chord: string, settle = 450) => {
      h.send(chordToBytes(chord));
      await delay(settle);
      const lines = h.frame();
      const faults = auditFrame(lines, columns);
      appendFileSync(
        GALLERY,
        `\n===== ${label}  [${chord}] =====\n${lines.map((l) => l.replace(/\s+$/, '')).join('\n')}\n` +
          (faults.length > 0 ? `!! ${faults.join('\n!! ')}\n` : ''),
      );
      if (faults.length > 0) problems.push(`${label} [${chord}]: ${faults.join('; ')}`);
    };

    // Every navigation target.
    for (const binding of DEFAULT_KEYMAP.filter((b) => b.id.startsWith('goto.'))) {
      await step(binding.description, binding.keys, 700);
    }

    // List verbs, on a populated list.
    h.send(chordToBytes('g w'));
    await delay(700);
    for (const binding of DEFAULT_KEYMAP.filter((b) => b.context === 'list')) {
      if (binding.id === 'list.open') continue; // opens a tab; covered separately
      await step(`list · ${binding.description}`, binding.keys);
      h.send('\x1b'); // back out of any filter/sort prompt
      await delay(150);
    }

    // Overlays.
    await step('command palette', 'ctrl+k', 700);
    h.send('\x1b');
    await delay(200);
    await step('help overlay', '?', 600);
    h.send('\x1b');
    await delay(200);
    await step('theme cycle', 'ctrl+t', 500);

    // The whole leader grammar.
    for (const binding of DEFAULT_KEYMAP.filter((b) => b.context === 'leader')) {
      await step(`leader · ${binding.description}`, `ctrl+b ${binding.keys}`, 500);
      h.send('\x1b');
      await delay(150);
    }

    h.stop();
    await delay(400);

    appendFileSync(
      GALLERY,
      `\n\n===== AUDIT =====\n${problems.length === 0 ? 'clean' : problems.join('\n')}\n`,
    );
    expect(problems).toEqual([]);
  }, 300000);
});

// ────────────────────────────────────────────────────────────────
// TUI end-to-end tests.
//
// The real workbench is mounted with injected TTY streams and its ANSI output
// is fed through a headless xterm, so every assertion runs against the painted
// screen — the cells a user would actually see — rather than against the
// escape sequences that produce them.
//
// A pseudo-terminal would be the other way to do this, but ConPTY cannot
// attach when the parent process has no console, which is the case for most
// CI runners and tool-driven shells; it kills every `node` child it spawns.
// Injecting the streams tests the same component tree, store, keymap and
// renderer, and leaves out only the kernel layer, which is not our code.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import xterm from '@xterm/headless';
import {
  buildRegistry,
  detectTerminal,
  loadConfig,
  type ResolvedCliConfig,
} from '@generatorai/cli-core';
import { Renderer } from '../render/Renderer.js';
import { createLogger } from '../logger.js';
import { launchTui } from '../tui/launch.js';
import type { Session } from '../session.js';

const Terminal = (xterm as unknown as { Terminal: typeof import('@xterm/headless').Terminal })
  .Terminal;

const SERVER = process.env['GENERATORAI_TEST_SERVER'] ?? 'http://127.0.0.1:3100';

export const KEY = {
  enter: '\r',
  esc: '\u001B',
  tab: '\t',
  shiftTab: '\u001B[Z',
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  backspace: '\u007F',
  ctrl: (letter: string) => String.fromCharCode(letter.toUpperCase().charCodeAt(0) - 64),
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Screen {
  readonly term: InstanceType<typeof Terminal>;
  readonly stdout: NodeJS.WriteStream;
  readonly stdin: NodeJS.ReadStream;
  raw = '';

  constructor(
    public columns = 120,
    public rows = 34,
  ) {
    this.term = new Terminal({ cols: columns, rows, allowProposedApi: true, scrollback: 4000 });

    const out = new PassThrough() as unknown as NodeJS.WriteStream;
    out.isTTY = true;
    out.columns = columns;
    out.rows = rows;
    // Ink strips every style unless the stream reports colour support.
    (out as unknown as { getColorDepth: () => number }).getColorDepth = () => 24;
    (out as unknown as { hasColors: () => boolean }).hasColors = () => true;
    out.on('data', (chunk: Buffer) => {
      const text = String(chunk);
      this.raw += text;
      // A real TTY translates LF to CRLF (termios ONLCR). Without it the
      // emulator never returns to column 0 and the frame cascades diagonally.
      this.term.write(text.replace(/\r?\n/g, '\r\n'));
    });
    this.stdout = out;

    const inp = new PassThrough() as unknown as NodeJS.ReadStream;
    inp.isTTY = true;
    inp.setRawMode = () => inp;
    // Ink refs stdin to keep the event loop alive; a PassThrough has neither.
    (inp as unknown as { ref: () => unknown }).ref = () => inp;
    (inp as unknown as { unref: () => unknown }).unref = () => inp;
    this.stdin = inp;
  }

  lines(): string[] {
    const buf = this.term.buffer.active;
    const out: string[] = [];
    for (let y = 0; y < this.rows; y++) {
      const line = buf.getLine(buf.viewportY + y);
      out.push(line ? line.translateToString(true).replace(/\s+$/, '') : '');
    }
    return out;
  }

  screen(): string {
    return this.lines().join('\n');
  }

  /** Box-drawing glyphs blanked so matches survive border-style changes. */
  text(): string {
    return this.screen().replace(/[\u2500-\u257F\u2580-\u259F]/g, ' ');
  }

  frame(title = ''): string {
    const head = title ? ` ${title} ` : '';
    const out = [`┌${head}${'─'.repeat(Math.max(0, this.columns - head.length))}┐`];
    for (const line of this.lines()) out.push(`│${line.slice(0, this.columns).padEnd(this.columns)}│`);
    out.push(`└${'─'.repeat(this.columns)}┘`);
    return out.join('\n');
  }

  press(key: string): this {
    (this.stdin as unknown as PassThrough).write(key);
    return this;
  }

  async type(text: string): Promise<this> {
    for (const ch of text) {
      (this.stdin as unknown as PassThrough).write(ch);
      await delay(4);
    }
    return this;
  }

  /**
   * Every keystroke in one read, as a real terminal delivers fast typing.
   *
   * `type` spaces its writes out, which is the friendly case; batching is the
   * one that used to make the whole app look frozen.
   */
  burst(text: string): this {
    (this.stdin as unknown as PassThrough).write(text);
    return this;
  }

  resize(columns: number, rows: number): this {
    this.columns = columns;
    this.rows = rows;
    this.term.resize(columns, rows);
    this.stdout.columns = columns;
    this.stdout.rows = rows;
    this.stdout.emit('resize');
    return this;
  }

  async waitFor(pattern: string | RegExp, timeout = 12000): Promise<void> {
    const hit =
      typeof pattern === 'string'
        ? (s: string) => s.includes(pattern)
        : (s: string) => pattern.test(s);
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (hit(this.screen()) || hit(this.text())) return;
      await delay(50);
    }
    throw new Error(`timeout waiting for ${String(pattern)}\n${this.frame('TIMEOUT')}`);
  }

  /** Resolves once `needle` is no longer painted. */
  async waitForGone(needle: string, timeout = 12000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (!this.screen().includes(needle)) return;
      await delay(50);
    }
    throw new Error(`timeout waiting for "${needle}" to go\n${this.frame('TIMEOUT')}`);
  }

  async settle(quietMs = 250, timeout = 8000): Promise<this> {
    const started = Date.now();
    let last = this.screen();
    let lastChange = Date.now();
    while (Date.now() - started < timeout) {
      await delay(60);
      const now = this.screen();
      if (now !== last) {
        last = now;
        lastChange = Date.now();
      } else if (Date.now() - lastChange >= quietMs) break;
    }
    return this;
  }

  dispose(): void {
    this.term.dispose();
  }
}

interface Mounted {
  screen: Screen;
  stop: () => Promise<void>;
}

let baseConfig: ResolvedCliConfig;

async function mount({ columns = 120, rows = 34 } = {}): Promise<Mounted> {
  const screen = new Screen(columns, rows);
  const abort = new AbortController();

  const capabilities = detectTerminal({
    stdout: { isTTY: true, columns, rows },
    overrides: { isTTY: true, columns, rows, colorDepth: 'truecolor', unicode: true },
  });

  const config: ResolvedCliConfig = {
    ...baseConfig,
    server: { ...baseConfig.server, url: SERVER },
    // Deterministic frames: the refresh backstop would otherwise repaint
    // mid-assertion and make failures irreproducible.
    tui: { ...baseConfig.tui, refreshMs: 0, restoreLayout: false },
  };

  const session: Session = {
    config,
    capabilities,
    renderer: new Renderer({ mode: 'auto', color: false, unicode: true, stdout: screen.stdout }),
    logger: createLogger({ verbose: false, capabilities, silentStderr: true }),
    outputMode: 'auto',
    dispose: async () => {},
  };

  const done = launchTui({
    session,
    flags: { server: SERVER },
    registry: buildRegistry({ version: '0.2.0-test' }),
    restore: false,
    signal: abort.signal,
    stdout: screen.stdout,
    stdin: screen.stdin,
  }).catch((error: unknown) => {
    // Unmount during teardown rejects the render promise; not a test failure.
    // Anything else is a crash the frame assertions would report only as a
    // blank screen, so it goes to a file Ink's patchConsole cannot swallow.
    if (!abort.signal.aborted) {
      appendFileSync('.tmp-tui-crash.log', `${new Date().toISOString()} ${String(error)}\n`);
    }
  });

  await screen.settle(300, 10000);

  return {
    screen,
    stop: async () => {
      abort.abort();
      await Promise.race([done, delay(2000)]);
      screen.dispose();
    },
  };
}

let active: Mounted | null = null;

beforeAll(async () => {
  baseConfig = await loadConfig({ flags: {}, flagNames: [] });
});

afterEach(async () => {
  if (active) {
    await active.stop();
    active = null;
  }
});

describe('TUI · shell', () => {
  it('paints the workbench chrome on first frame', async () => {
    active = await mount();
    const { screen } = active;

    await screen.waitFor('GeneratorAI');
    const text = screen.text();

    expect(text).toContain('GeneratorAI');
    // Status bar affordances must be discoverable without reading docs.
    expect(text).toMatch(/palette/i);
    expect(text).toMatch(/help/i);
    expect(text).toMatch(/quit/i);
  }, 40000);

  it('enters the alternate screen before the first paint', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    const enter = screen.raw.indexOf('\u001B[?1049h');
    const firstText = screen.raw.indexOf('GeneratorAI');
    expect(enter).toBeGreaterThanOrEqual(0);
    // Painting before the switch would leave the alternate buffer empty.
    expect(enter).toBeLessThan(firstText);
  }, 40000);

  it('shows the connection endpoint in the status bar', async () => {
    active = await mount();
    await active.screen.waitFor(/127\.0\.0\.1:3100|localhost:3100/);
  }, 40000);
});

describe('TUI · navigation', () => {
  it('opens the command palette and filters it', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    screen.press(KEY.ctrl('k'));
    await screen.settle();
    await screen.waitFor(/palette|command/i);

    await screen.type('workflow');
    await screen.settle();
    expect(screen.text().toLowerCase()).toContain('workflow');

    screen.press(KEY.esc);
    await screen.settle();
  }, 40000);

  it('toggles the help overlay with ?', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    screen.press('?');
    // Match the overlay title, not the status-bar hint, which also says "help".
    await screen.waitFor('Keyboard shortcuts');
    expect(screen.text()).toContain('Command palette');

    screen.press(KEY.esc);
    await screen.settle();
    expect(screen.text()).not.toContain('Keyboard shortcuts');
  }, 40000);

  it('pages through the help overlay', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    screen.press('?');
    await screen.waitFor('Keyboard shortcuts');
    await screen.waitFor(/page 1\/\d/);

    screen.press(KEY.right);
    await screen.waitFor(/page 2\/\d/);

    screen.press(KEY.esc);
    await screen.settle();
  }, 40000);

  it('navigates between sections with the g-prefix', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    screen.press('g');
    screen.press('w');
    await screen.settle();
    expect(screen.text().toLowerCase()).toMatch(/workflow/);

    screen.press('g');
    screen.press('r');
    await screen.settle();
    expect(screen.text().toLowerCase()).toMatch(/run/);
  }, 40000);

  it.each([
    ['d', 'Dashboard'],
    ['c', 'Chats'],
    ['w', 'Workflows'],
    ['r', 'Runs'],
    ['a', 'Automations'],
    ['p', 'Projects'],
    ['o', 'Workspaces'],
    ['e', 'Agents'],
    ['s', 'Scripts'],
    ['x', 'Extensions'],
    [',', 'Settings'],
  ])('reaches %s → %s and titles the tab', async (key, title) => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    screen.press('g');
    await delay(60);
    screen.press(key);
    // The tab strip is the authority on which section is open.
    await screen.waitFor(new RegExp(`1\\s+${title}`));
  }, 40000);

  it('renders the dashboard summary counters', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('Dashboard');
    const text = screen.text();
    for (const section of ['Chats', 'Workflows', 'Runs', 'Automations', 'Projects']) {
      expect(text).toContain(section);
    }
  }, 40000);

  it('handles a two-key sequence that arrives in a single read', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    // A real terminal hands Ink "gw" as one string when typed quickly. Matched
    // whole it binds to nothing, which is what made every key look dead.
    screen.burst('gw');
    await screen.waitFor(/1\s+Workflows/);
  }, 40000);

  it('opens the palette from a burst and still sees Escape', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    // Ctrl+K then a search term in one read: the chord must be recognised and
    // the remaining characters must reach the palette's field, not vanish.
    screen.burst('\u000bworkflow');
    await screen.waitFor('Command palette');
    await screen.waitFor('workflow');
    screen.press(KEY.esc);
    await screen.waitForGone('Command palette');
  }, 40000);
});

describe('TUI · chat surface', () => {
  it('opens a chat into its own tab and shows a composer', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    screen.press('g');
    await delay(60);
    screen.press('c');
    await screen.waitFor(/1\s+Chats/);

    screen.press(KEY.enter);
    // The composer is the affordance that makes the surface usable at all.
    await screen.waitFor('Send a message', 20000);
    expect(screen.text()).toMatch(/⏎ send/);
  }, 60000);

  it('keeps text containing navigation letters in the composer', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');
    screen.press('g');
    await delay(60);
    screen.press('c');
    await screen.waitFor(/1\s+Chats/);
    screen.press(KEY.enter);
    await screen.waitFor('Send a message', 20000);

    // `g o` is "go to Workspaces". Typing a word must not navigate away, and
    // the characters must land in order.
    await screen.type('good morning');
    await screen.settle();

    expect(screen.text()).toContain('good morning');
    expect(screen.text()).not.toMatch(/Workspaces\s+\d/);
  }, 60000);

  it('shows chat-appropriate key hints, not list hints', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');
    screen.press('g');
    await delay(60);
    screen.press('c');
    await screen.waitFor(/1\s+Chats/);
    screen.press(KEY.enter);
    await screen.waitFor('Send a message', 20000);

    // "⏎ open" would be a lie here: Enter sends.
    const hints = screen.lines().at(-1) ?? '';
    expect(hints).not.toMatch(/open/);
    expect(hints).toMatch(/close chat/);
  }, 60000);

  it('closes the chat tab with Escape', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');
    screen.press('g');
    await delay(60);
    screen.press('c');
    await screen.waitFor(/1\s+Chats/);
    screen.press(KEY.enter);
    await screen.waitFor('Send a message', 20000);

    screen.press(KEY.esc);
    // Ink reports a lone Escape as meta; if that is trusted, Esc matches
    // nothing and the tab never closes.
    await screen.waitForGone('Send a message');
    expect(screen.text()).toMatch(/1\s+Chats/);
  }, 60000);
});

describe('TUI · panes', () => {
  it('arms the leader and reports it in the status bar', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    screen.press(KEY.ctrl('b'));
    await screen.waitFor(/LEADER/);

    screen.press(KEY.esc);
    await screen.settle();
  }, 40000);

  it('opens a second tab with leader-c', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');
    expect(screen.text()).toContain('1 Dashboard');

    screen.press(KEY.ctrl('b'));
    await screen.waitFor(/LEADER/);
    screen.press('c');
    await screen.waitFor('2 Dashboard');
  }, 40000);

  it('splits the pane vertically with leader-%', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    screen.press(KEY.ctrl('b'));
    await screen.waitFor(/LEADER/);
    screen.press('%');
    await screen.settle();

    // Two panels side by side means two panel borders meet on one row.
    const split = screen.lines().some((l) => /╮\s*╭|╭.*╭/.test(l));
    expect(split).toBe(true);
  }, 40000);

  it('closes a split pane with leader-x', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    screen.press(KEY.ctrl('b'));
    await screen.waitFor(/LEADER/);
    screen.press('%');
    await screen.settle();

    screen.press(KEY.ctrl('b'));
    await screen.waitFor(/LEADER/);
    screen.press('x');
    await screen.settle();

    const stillSplit = screen.lines().some((l) => /╮\s*╭/.test(l));
    expect(stillSplit).toBe(false);
  }, 40000);

  it('disarms the leader automatically after a timeout', async () => {
    active = await mount();
    const { screen } = active;
    await screen.waitFor('GeneratorAI');

    screen.press(KEY.ctrl('b'));
    await screen.waitFor(/LEADER/);
    // A stray prefix must not swallow the next keystroke minutes later.
    await delay(3400);
    await screen.settle();
    expect(screen.text()).not.toMatch(/LEADER/);
  }, 40000);
});

describe('TUI · responsive layout', () => {
  it('reflows when the terminal is resized', async () => {
    active = await mount({ columns: 160, rows: 40 });
    const { screen } = active;
    await screen.waitFor('GeneratorAI');
    const wide = screen.screen();

    screen.resize(90, 28);
    await screen.settle();
    const narrow = screen.screen();

    expect(narrow).not.toEqual(wide);
    // The frame must still be intact after reflow, not truncated mid-render.
    expect(narrow).toContain('GeneratorAI');
    for (const line of screen.lines()) expect(line.length).toBeLessThanOrEqual(90);
  }, 40000);

  it('stays within bounds at the minimum supported size', async () => {
    active = await mount({ columns: 60, rows: 14 });
    const { screen } = active;
    await screen.settle();
    for (const line of screen.lines()) expect(line.length).toBeLessThanOrEqual(60);
  }, 40000);
});

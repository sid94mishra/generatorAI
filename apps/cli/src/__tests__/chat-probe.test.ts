import { describe, expect, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import xterm from '@xterm/headless';
import type { Terminal as XtermTerminal } from '@xterm/headless';
import { buildRegistry, detectTerminal, loadConfig } from '@generatorai/cli-core';
import { Renderer } from '../render/Renderer.js';
import { createLogger } from '../logger.js';
import { launchTui } from '../tui/launch.js';
import type { Session } from '../session.js';
import { probeLiveServer } from './helpers/liveServerProbe.js';

const Terminal = (xterm as unknown as { Terminal: typeof XtermTerminal }).Terminal;
const SERVER = process.env['GENERATORAI_TEST_SERVER'] ?? 'http://127.0.0.1:3100';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CTRL = (l: string) => String.fromCharCode(l.toUpperCase().charCodeAt(0) - 64);
const OUT = 'chat-probe.txt';

describe('chat surface', () => {
  // A developer probe against a real, already-running server with real chat
  // history and a real model catalog — not a hermetic CI test. Skips
  // cleanly (rather than failing on a raw "fetch failed") when nothing is
  // listening at SERVER. See helpers/liveServerProbe.ts.
  it('shows history, slash menu and model picker', async (ctx) => {
    if (!(await probeLiveServer(SERVER))) return ctx.skip();
    const columns = 130, rows = 34;
    const term = new Terminal({ cols: columns, rows, allowProposedApi: true });
    const out = new PassThrough() as unknown as NodeJS.WriteStream;
    out.isTTY = true; out.columns = columns; out.rows = rows;
    (out as unknown as { getColorDepth: () => number }).getColorDepth = () => 24;
    (out as unknown as { hasColors: () => boolean }).hasColors = () => true;
    out.on('data', (c: Buffer) => term.write(String(c).replace(/\r?\n/g, '\r\n')));
    const inp = new PassThrough() as unknown as NodeJS.ReadStream;
    inp.isTTY = true; inp.setRawMode = () => inp;
    (inp as unknown as { ref: () => unknown }).ref = () => inp;
    (inp as unknown as { unref: () => unknown }).unref = () => inp;

    const base = await loadConfig({ flags: {}, flagNames: [] });
    const capabilities = detectTerminal({
      stdout: { isTTY: true, columns, rows },
      overrides: { isTTY: true, columns, rows, colorDepth: 'truecolor', unicode: true },
    });
    const session: Session = {
      config: { ...base, server: { ...base.server, url: SERVER }, tui: { ...base.tui, refreshMs: 0, restoreLayout: false } },
      capabilities,
      renderer: new Renderer({ mode: 'auto', color: false, unicode: true, stdout: out }),
      logger: createLogger({ verbose: false, capabilities, silentStderr: true }),
      outputMode: 'auto', dispose: async () => {},
    };
    writeFileSync(OUT, '');
    const abort = new AbortController();
    const done = launchTui({ session, flags: {}, registry: buildRegistry({ version: 'chat' }), restore: false, signal: abort.signal, stdout: out, stdin: inp })
      .catch((e) => appendFileSync(OUT, `REJECTED ${String(e)}\n`));

    const w = (s: string) => (inp as unknown as PassThrough).write(s);
    const lines = (): string[] => {
      const b = term.buffer.active; const ls: string[] = [];
      for (let y = 0; y < rows; y++) { const l = b.getLine(b.viewportY + y); ls.push(l ? l.translateToString(true).replace(/\s+$/, '') : ''); }
      return ls;
    };
    const text = (): string => lines().join('\n');
    const dump = (label: string) => {
      appendFileSync(OUT, `\n===== ${label} =====\n${lines().join('\n')}\n`);
    };

    await delay(4000);
    w('g'); await delay(80); w('c'); await delay(2200);
    w('\r'); await delay(5000);
    dump('CHAT WITH HISTORY');
    expect(text()).toMatch(/Send a message/);
    // A transcript has to say who is speaking; the assistant label alone is
    // not enough to tell the turns apart.
    expect(lines().some((l) => /^[│\s]*you[\s│]*$/.test(l))).toBe(true);
    expect(lines().some((l) => /^[│\s]*assistant[\s│]*$/.test(l))).toBe(true);

    for (const ch of '/mod') { w(ch); await delay(90); }
    await delay(1500);
    dump('SLASH MENU');
    expect(text()).toMatch(/\/model/);

    // Enter accepts the highlighted completion; the composer still holds the
    // command, so a second Enter is what actually runs it.
    w('\r'); await delay(600);
    w('\r');

    // The picker waits on a round trip. A server busy serving the rest of the
    // suite can outlast the client's deadline, which the UI reports honestly;
    // retry rather than pretend the timeout is a product failure.
    for (let attempt = 0; attempt < 3; attempt++) {
      for (let i = 0; i < 40 && !/Model for this chat/.test(text()); i++) await delay(250);
      if (/Model for this chat/.test(text())) break;
      for (const ch of '/model') { w(ch); await delay(60); }
      await delay(400);
      w('\r'); await delay(400);
      w('\r');
    }
    dump('MODEL PICKER');
    expect(text()).toMatch(/Model for this chat/);
    // Only useful if it lists models the server really offers.
    expect(text()).toMatch(/Claude|GPT|Auto/);

    w('\x1b');
    for (let i = 0; i < 20 && /Model for this chat/.test(text()); i++) await delay(150);
    expect(text()).not.toMatch(/Model for this chat/);
    expect(text()).toMatch(/Send a message/);

    abort.abort();
    await Promise.race([done, delay(2000)]);
  }, 90000);
});

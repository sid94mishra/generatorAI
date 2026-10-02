import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserInspectorSelection, ILogger } from '@generatorai/shared';
import type { BrowserHandle } from '../../../domain/ports/IBrowserBridge.js';
import { ServerPlaywrightHost } from '../ServerPlaywrightHost.js';

// MG-24 spike (mobile "tap an element to comment" on the streamed browser).
// A remote client has no inspector of its own: it turns the inspector on
// (`POST …/browser/actions {kind:'inspector', on:true}`) and sends the tap as
// input (`POST …/browser/input {type:'mouse.click', x, y}`). This proves the
// tap reaches the page's inspector and yields the element under it, which
// BrowserService then emits to every client as `browser.selection`.
// Opt-in: requires Playwright Chromium or GENERATORAI_BROWSER_EXECUTABLE_PATH.
describe.skipIf(process.env['GENERATORAI_LIVE_BROWSER_TEST'] !== '1')('element pick through remote input (MG-24)', () => {
  it('a tap at (x, y) with the inspector on selects the element under it, once', async () => {
    const page = `<!doctype html><title>Pick</title><body style="margin:0">
      <button id="save" style="position:absolute;left:40px;top:60px;width:120px;height:40px">Save</button>
      <p id="note" style="position:absolute;left:40px;top:200px">Note</p></body>`;
    const server = createServer((_req, res) => res.setHeader('content-type', 'text/html').end(page));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const root = await mkdtemp(join(tmpdir(), 'gai-element-pick-'));
    const host = new ServerPlaywrightHost({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger);
    const selections: BrowserInspectorSelection[] = [];
    let handle: BrowserHandle | undefined;
    try {
      handle = await host.start(
        { workspaceId: 'element-pick-test', workspaceRoot: root, config: { allowedHosts: ['127.0.0.1'], headless: true } },
        { onInspectorSelection: (_h, sel) => void selections.push(sel) },
      );
      expect((await host.navigate(handle, `http://127.0.0.1:${port}/`)).ok).toBe(true);

      await host.inspector(handle, true);
      await host.interact(handle, { type: 'mouse.click', x: 100, y: 80, button: 'left' });
      await expect.poll(() => selections.length, { timeout: 10_000 }).toBe(1);
      expect(selections[0]).toMatchObject({ cssSelector: expect.stringContaining('save'), url: `http://127.0.0.1:${port}/` });
      expect(selections[0]!.boundingBox).toMatchObject({ x: 40, y: 60, width: 120, height: 40 });

      // The inspector turns itself off after one pick: the next tap is an ordinary click.
      await host.interact(handle, { type: 'mouse.click', x: 60, y: 205, button: 'left' });
      await new Promise((r) => setTimeout(r, 500));
      expect(selections).toHaveLength(1);
    } finally {
      if (handle) await host.stop(handle);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);
});

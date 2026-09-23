import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ILogger } from '@generatorai/shared';
import type { BrowserHandle } from '../../../domain/ports/IBrowserBridge.js';
import { ServerPlaywrightHost } from '../ServerPlaywrightHost.js';

// Opt-in: requires Playwright Chromium or GENERATORAI_BROWSER_EXECUTABLE_PATH.
// Exercises real request interception, including a non-default local port.
describe.skipIf(process.env['GENERATORAI_LIVE_BROWSER_TEST'] !== '1')('browser host allowlist', () => {
  it('loads an explicitly allowed hostname on a dev port and blocks unlisted hosts', async () => {
    const server = createServer((_req, res) => res.end('<title>Local preview</title>preview'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const root = await mkdtemp(join(tmpdir(), 'gai-host-policy-'));
    const host = new ServerPlaywrightHost({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger);
    let handle: BrowserHandle | undefined;
    try {
      handle = await host.start({ workspaceId: 'host-policy-test', workspaceRoot: root, config: { allowedHosts: ['127.0.0.1'], headless: true } });
      const allowed = await host.navigate(handle, `http://127.0.0.1:${port}/`);
      expect(allowed.ok).toBe(true);
      expect(allowed.title).toBe('Local preview');
      const blocked = await host.navigate(handle, `http://localhost:${port}/`);
      expect(blocked.ok).toBe(false);
      expect(blocked.error).toContain('ERR_FAILED');
    } finally {
      if (handle) await host.stop(handle);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);
});

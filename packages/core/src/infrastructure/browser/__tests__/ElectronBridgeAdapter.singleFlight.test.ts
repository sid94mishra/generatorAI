// ────────────────────────────────────────────────────────────────
// The scoped CDP proxy admits ONE client and evicts the previous one whenever
// another connects. Concurrent callers that each opened their own connection
// therefore knocked each other off mid-handshake: after a tab changed, the
// SPA's status polls raced an agent's tool call, every one of them hung, and
// the hung polls exhausted the browser's per-origin connection pool.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi, beforeEach } from 'vitest';

const connects: string[] = [];

/** A stand-in for any Playwright object: every property is a harmless spy. */
function stub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return new Proxy(overrides, {
    get: (target, prop: string) =>
      prop in target ? target[prop] : (prop === 'then' ? undefined : vi.fn(async () => undefined)),
  });
}

vi.mock('playwright', () => ({
  chromium: {
    connectOverCDP: vi.fn(async (endpoint: string) => {
      connects.push(endpoint);
      await new Promise((r) => setTimeout(r, 20)); // a real handshake takes a moment
      const page = stub({ url: () => 'https://example.com/', title: async () => 'Example', viewportSize: () => ({ width: 800, height: 600 }), on: vi.fn(), off: vi.fn() });
      const context = stub({ pages: () => [page], on: vi.fn() });
      return stub({ contexts: () => [context], isConnected: () => true, on: vi.fn() });
    }),
  },
}));

const { ElectronBridgeAdapter } = await import('../ElectronBridgeAdapter.js');

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
const startOpts = { workspaceId: 'ws-1', workspaceRoot: '/tmp/ws-1', config: {} as never };

beforeEach(() => { connects.length = 0; });

describe('ElectronBridgeAdapter — one CDP connection at a time', () => {
  it('shares one connection between concurrent starts', async () => {
    const adapter = new ElectronBridgeAdapter(logger);
    adapter.setEndpoint('ws-1', 'ws://127.0.0.1:1/a');
    const [a, b] = await Promise.all([adapter.start(startOpts), adapter.start(startOpts)]);
    expect(a).toBe(b);
    expect(connects).toEqual(['ws://127.0.0.1:1/a']);
  });

  it('reconnects once for every concurrent caller after the tab changes', async () => {
    const adapter = new ElectronBridgeAdapter(logger);
    adapter.setEndpoint('ws-1', 'ws://127.0.0.1:1/a');
    const handle = await adapter.start(startOpts);
    adapter.setEndpoint('ws-1', 'ws://127.0.0.1:1/b');

    const results = await Promise.all([1, 2, 3, 4].map(() => adapter.describe(handle)));
    expect(results.every((r) => r.url === 'https://example.com/')).toBe(true);
    expect(connects).toEqual(['ws://127.0.0.1:1/a', 'ws://127.0.0.1:1/b']);
  });
});

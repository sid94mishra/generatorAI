// probeKnownServers (G-03, P1-review P2-R6): main probes every known server,
// because the renderer's CSP only allows its own origin. P2-R40 — it probes
// with Electron's `net.fetch`, not Node's global `fetch`: `net.fetch` shares
// Chrome's network stack (proxy/cert policy), so its verdict matches what the
// renderer's window would actually be able to load.

import { describe, expect, it, vi } from 'vitest';

const netFetchMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({ net: { fetch: netFetchMock } }));

import { probeKnownServers, SERVER_PROBE_TIMEOUT_MS, type KnownServer } from '../server-probe';
import type { ProbeServerOptions } from '@generatorai/client-runtime/connections';

const embedded: KnownServer = {
  id: 'embedded',
  label: 'This computer',
  url: 'http://127.0.0.1:3100',
  kind: 'embedded',
  active: true,
};
const remote: KnownServer = {
  id: 'srv-1',
  label: 'Studio',
  url: 'https://studio.example:3100',
  kind: 'remote',
  active: false,
  expectedServerId: 'host-fp-1',
};

describe('probeKnownServers', () => {
  it('probes every entry with the bounded timeout and merges the result', async () => {
    const probe = vi.fn(async (url: string) =>
      url === embedded.url
        ? { status: 'connected' as const, serverName: 'Mine', latencyMs: 3 }
        : { status: 'offline' as const },
    );
    const result = await probeKnownServers([embedded, remote], probe);
    expect(result).toEqual([
      { id: 'embedded', label: 'This computer', url: embedded.url, kind: 'embedded', active: true, status: 'connected', serverName: 'Mine', latencyMs: 3 },
      { id: 'srv-1', label: 'Studio', url: remote.url, kind: 'remote', active: false, status: 'offline' },
    ]);
    expect(probe).toHaveBeenCalledWith(embedded.url, {
      timeoutMs: SERVER_PROBE_TIMEOUT_MS,
      fetch: expect.any(Function),
    });
    // The expected identity is passed to the probe, never leaked into the IPC payload.
    expect(probe).toHaveBeenCalledWith(remote.url, {
      timeoutMs: SERVER_PROBE_TIMEOUT_MS,
      fetch: expect.any(Function),
      expectedServerId: 'host-fp-1',
    });
  });

  it('passes Electron\'s net.fetch (proxy/cert-consistent with the window), not Node\'s global fetch', async () => {
    const probe = vi.fn(async (_url: string, options?: ProbeServerOptions) => {
      // Prove it is really wired to `net.fetch`: call it and check the mock saw it.
      await options?.fetch?.('http://example.invalid/api/auth/server-info');
      return { status: 'offline' as const };
    });
    netFetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await probeKnownServers([embedded], probe);
    expect(netFetchMock).toHaveBeenCalledWith('http://example.invalid/api/auth/server-info', undefined);
  });

  it('runs the probes in parallel', async () => {
    const resolvers: Array<() => void> = [];
    const probe = vi.fn(
      () =>
        new Promise<{ status: 'connected' }>((resolve) => {
          resolvers.push(() => resolve({ status: 'connected' }));
        }),
    );
    const pending = probeKnownServers([embedded, remote], probe);
    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(2);
    for (const r of resolvers) r();
    expect(await pending).toHaveLength(2);
  });

  it('reports an entry with no url (embedded server not started) as offline without probing', async () => {
    const probe = vi.fn();
    const result = await probeKnownServers([{ ...embedded, url: '' }], probe);
    expect(result[0]).toMatchObject({ id: 'embedded', status: 'offline' });
    expect(probe).not.toHaveBeenCalled();
  });
});

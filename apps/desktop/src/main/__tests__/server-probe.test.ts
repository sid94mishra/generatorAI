// probeKnownServers (G-03, P1-review P2-R6): main probes every known server
// with Node `fetch`, because the renderer's CSP only allows its own origin.

import { describe, expect, it, vi } from 'vitest';
import { probeKnownServers, SERVER_PROBE_TIMEOUT_MS, type KnownServer } from '../server-probe';

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
    expect(probe).toHaveBeenCalledWith(embedded.url, { timeoutMs: SERVER_PROBE_TIMEOUT_MS });
    // The expected identity is passed to the probe, never leaked into the IPC payload.
    expect(probe).toHaveBeenCalledWith(remote.url, { timeoutMs: SERVER_PROBE_TIMEOUT_MS, expectedServerId: 'host-fp-1' });
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

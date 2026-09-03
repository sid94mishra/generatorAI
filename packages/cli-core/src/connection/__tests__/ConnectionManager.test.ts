import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkProtocolCompatibility, probeEndpoint, SUPPORTED_PROTOCOL_VERSIONS } from '../ConnectionManager.js';

describe('checkProtocolCompatibility', () => {
  it('treats no advertised version as compatible — an old server predating this field must not be refused', () => {
    expect(checkProtocolCompatibility(undefined)).toBe('unknown');
  });

  it('is compatible anywhere inside the supported range', () => {
    for (let v = SUPPORTED_PROTOCOL_VERSIONS.min; v <= SUPPORTED_PROTOCOL_VERSIONS.max; v++) {
      expect(checkProtocolCompatibility(v)).toBe('compatible');
    }
  });

  it('flags a server below the minimum as too old', () => {
    expect(checkProtocolCompatibility(SUPPORTED_PROTOCOL_VERSIONS.min - 1)).toBe('server-too-old');
  });

  it('flags a server above the maximum as ahead, not incompatible', () => {
    expect(checkProtocolCompatibility(SUPPORTED_PROTOCOL_VERSIONS.max + 1)).toBe('server-ahead');
  });
});

describe('probeEndpoint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the server's ACTUAL field names (serverName, protocolVersion) — not the fabricated name/version this used to look for", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            serverId: 'srv_1',
            serverName: 'workstation',
            protocolVersion: 2,
            authentication: { required: true, dpopRequired: true, legacyApiKeyAccepted: false },
            transports: { loopback: true, lan: false, privateNetwork: false, relay: false },
          }),
          { status: 200 },
        ),
      ),
    );

    const probe = await probeEndpoint('http://127.0.0.1:3100');

    expect(probe.ok).toBe(true);
    expect(probe.serverId).toBe('srv_1');
    // The bug: this used to read `info.name` (a field the server has never
    // sent) and `info.version` (ditto) — both were silently always
    // undefined for every real server. Confirms the fix actually populates
    // them from the real field names.
    expect(probe.serverName).toBe('workstation');
    expect(probe.protocolVersion).toBe(2);
    expect(probe.capabilities).toEqual({
      authentication: { required: true, dpopRequired: true, legacyApiKeyAccepted: false },
      transports: { loopback: true, lan: false, privateNetwork: false, relay: false },
    });
  });

  it('omits protocolVersion/serverName/capabilities entirely when the server response has none of them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ serverId: 'srv_1' }), { status: 200 })),
    );

    const probe = await probeEndpoint('http://127.0.0.1:3100');

    expect(probe.ok).toBe(true);
    expect(probe.protocolVersion).toBeUndefined();
    expect(probe.serverName).toBeUndefined();
    expect(probe.capabilities).toBeUndefined();
  });

  it('reports ok:false with the HTTP status on a non-2xx response, without touching version fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));

    const probe = await probeEndpoint('http://127.0.0.1:3100');

    expect(probe.ok).toBe(false);
    expect(probe.error).toBe('HTTP 503');
  });
});

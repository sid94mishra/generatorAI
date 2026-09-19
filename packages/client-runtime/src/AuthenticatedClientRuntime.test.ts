import { describe, expect, it, vi } from 'vitest';
import {
  AuthenticatedClientRuntime,
  CredentialRejectedError,
  DeviceRevokedError,
} from './AuthenticatedClientRuntime.js';
import { MemoryDeviceKeyStore, MemorySessionStore } from './nodeStores.js';

const SERVER_ID = 'server-id-pinned-at-pairing';

function sessionResponse(): Response {
  return Response.json({
    deviceId: 'device-1',
    deviceName: 'Phone',
    scopes: ['chat:read'],
    accessToken: 'access-token',
    accessTokenExpiresAt: Date.now() + 10 * 60_000,
    resumeSecret: 'resume-secret',
    resumeExpiresAt: Date.now() + 48 * 60 * 60_000,
    credentialVersion: 1,
  }, { status: 201 });
}

describe('AuthenticatedClientRuntime endpoint trust', () => {
  it('does not send a pairing grant when no endpoint can prove the pinned identity', async () => {
    const requests: string[] = [];
    const runtime = new AuthenticatedClientRuntime({
      endpoint: 'http://192.168.1.20:3100',
      keyStore: new MemoryDeviceKeyStore(),
      sessionStore: new MemorySessionStore(),
      fetchImpl: vi.fn(async (input) => {
        requests.push(String(input));
        return new Response(null, { status: 503 });
      }),
    });

    await expect(runtime.completePairing({
      endpoint: 'http://192.168.1.20:3100',
      serverId: SERVER_ID,
      pairingToken: 'pairing-secret-must-stay-local',
      deviceName: 'Phone',
      platform: 'mobile',
    })).rejects.toThrow('Could not verify the paired server identity');

    expect(requests).toEqual(['http://192.168.1.20:3100/api/auth/server-info']);
  });

  it('retries the identity probe after a failed attempt instead of caching the failure', async () => {
    let online = false;
    const runtime = new AuthenticatedClientRuntime({
      endpoint: 'http://192.168.1.20:3100',
      keyStore: new MemoryDeviceKeyStore(),
      sessionStore: new MemorySessionStore(),
      fetchImpl: vi.fn(async (input) => {
        const url = String(input);
        if (!online) throw new Error('network unavailable');
        if (url.endsWith('/api/auth/server-info')) return Response.json({ serverId: SERVER_ID });
        if (url.endsWith('/api/auth/pair/complete')) return sessionResponse();
        return new Response(null, { status: 404 });
      }),
    });
    const pairing = {
      endpoint: 'http://192.168.1.20:3100',
      serverId: SERVER_ID,
      pairingToken: 'pairing-secret',
      deviceName: 'Phone',
      platform: 'mobile' as const,
    };

    await expect(runtime.completePairing(pairing)).rejects.toThrow('Could not verify the paired server identity');
    online = true;
    await expect(runtime.completePairing(pairing)).resolves.toBeTruthy();
  });

  it('falls back to the next matching endpoint and uses it for HTTP and stream URLs', async () => {
    const requests: string[] = [];
    const runtime = new AuthenticatedClientRuntime({
      endpoint: 'http://192.168.1.20:3100',
      keyStore: new MemoryDeviceKeyStore(),
      sessionStore: new MemorySessionStore(),
      fetchImpl: vi.fn(async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.startsWith('http://192.168.1.20:3100')) throw new Error('network unavailable');
        if (url.endsWith('/api/auth/server-info')) return Response.json({ serverId: SERVER_ID });
        if (url.endsWith('/api/auth/pair/complete')) return sessionResponse();
        if (url.endsWith('/api/stream/tickets')) {
          return Response.json({ ticket: `ticket-${requests.length}` });
        }
        return Response.json({ ok: true });
      }),
    });

    const session = await runtime.completePairing({
      endpoint: 'http://192.168.1.20:3100',
      endpoints: ['http://192.168.1.20:3100', 'http://10.0.0.8:3100'],
      serverId: SERVER_ID,
      pairingToken: 'pairing-secret',
      deviceName: 'Phone',
      platform: 'mobile',
    });

    expect(session.endpoint).toBe('http://10.0.0.8:3100');
    expect(await runtime.buildStreamUrl('chat:read', 'chat-1')).toMatch(
      /^http:\/\/10\.0\.0\.8:3100\/api\/stream\?/,
    );
    expect(await runtime.buildSocketUrl('/api/terminal', 'exec:terminal', null)).toMatch(
      /^ws:\/\/10\.0\.0\.8:3100\/api\/terminal\?/,
    );
    expect(requests).toContain('http://10.0.0.8:3100/api/auth/pair/complete');
    expect(requests.filter((url) => url.endsWith('/api/stream/tickets'))).toHaveLength(2);
  });

  it('keeps the pairing when a refresh is rejected but the device is not revoked', async () => {
    let now = 0;
    const sessionStore = new MemorySessionStore();
    const runtime = new AuthenticatedClientRuntime({
      endpoint: 'http://127.0.0.1:3100',
      keyStore: new MemoryDeviceKeyStore(),
      sessionStore,
      clock: () => now,
      fetchImpl: vi.fn(async (input) => {
        const url = String(input);
        if (url.endsWith('/api/auth/server-info')) return Response.json({ serverId: SERVER_ID });
        if (url.endsWith('/api/auth/pair/complete')) {
          return Response.json({
            deviceId: 'device-1',
            deviceName: 'Phone',
            scopes: ['chat:read'],
            accessToken: 'short-access-token',
            accessTokenExpiresAt: 30_000,
            resumeSecret: 'resume-secret',
            resumeExpiresAt: 60_000,
            credentialVersion: 1,
          }, { status: 201 });
        }
        if (url.endsWith('/api/auth/token/refresh')) {
          return Response.json(
            { error: { code: 'INVALID_GRANT', message: 'Credential rotated' } },
            { status: 400 },
          );
        }
        return Response.json({ ok: true });
      }),
    });

    await runtime.completePairing({
      endpoint: 'http://127.0.0.1:3100',
      serverId: SERVER_ID,
      pairingToken: 'pairing-secret',
      deviceName: 'Phone',
      platform: 'mobile',
    });
    now = 60_000;

    // INVALID_GRANT says the CREDENTIAL is unusable, not that the device was
    // revoked — a server that could not durably persist the rotated secret
    // answers exactly this. The runtime retries once, then surfaces an error
    // the user can act on; it does NOT destroy the pairing, which is what
    // turned a full disk into a trip back to the host machine.
    await expect(runtime.fetch('/api/projects')).rejects.toBeInstanceOf(CredentialRejectedError);
    expect(await sessionStore.load()).not.toBeNull();
    expect(runtime.currentState.status).toBe('error');
  });

  it('clears persisted credentials when the server says the device is revoked', async () => {
    let now = 0;
    const sessionStore = new MemorySessionStore();
    const runtime = new AuthenticatedClientRuntime({
      endpoint: 'http://127.0.0.1:3100',
      keyStore: new MemoryDeviceKeyStore(),
      sessionStore,
      clock: () => now,
      fetchImpl: vi.fn(async (input) => {
        const url = String(input);
        if (url.endsWith('/api/auth/server-info')) return Response.json({ serverId: SERVER_ID });
        if (url.endsWith('/api/auth/pair/complete')) {
          return Response.json(
            {
              deviceId: 'device-1',
              deviceName: 'Phone',
              scopes: ['chat:read'],
              accessToken: 'short-access-token',
              accessTokenExpiresAt: 30_000,
              resumeSecret: 'resume-secret',
              resumeExpiresAt: 60_000,
              credentialVersion: 1,
            },
            { status: 201 },
          );
        }
        if (url.endsWith('/api/auth/token/refresh')) {
          return Response.json(
            { error: { code: 'REVOKED', message: 'Device has been revoked' } },
            { status: 401 },
          );
        }
        return Response.json({ ok: true });
      }),
    });

    await runtime.completePairing({
      endpoint: 'http://127.0.0.1:3100',
      serverId: SERVER_ID,
      pairingToken: 'pairing-secret',
      deviceName: 'Phone',
      platform: 'mobile',
    });
    now = 60_000;

    await expect(runtime.fetch('/api/projects')).rejects.toBeInstanceOf(DeviceRevokedError);
    expect(await sessionStore.load()).toBeNull();
    expect(runtime.currentState.status).toBe('revoked');
  });

  it('spends a server nonce on one proof instead of signing it into every later request', async () => {
    // Server nonces are single-use. The runtime used to keep the nonce from a
    // `use_dpop_nonce` challenge and put it in every later proof, so every
    // request after the retry carried a spent nonce, was rejected, and the
    // client stayed locked out until it re-paired.
    const spent = new Set<string>();
    let challenged = false;
    const nonceOf = (init: RequestInit | undefined): string | undefined => {
      const proof = (init?.headers as Record<string, string> | undefined)?.['dpop'];
      if (!proof) return undefined;
      const payload = JSON.parse(Buffer.from(proof.split('.')[1]!, 'base64url').toString('utf8')) as { nonce?: string };
      return payload.nonce;
    };
    const runtime = new AuthenticatedClientRuntime({
      endpoint: 'http://127.0.0.1:3100',
      keyStore: new MemoryDeviceKeyStore(),
      sessionStore: new MemorySessionStore(),
      fetchImpl: vi.fn(async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/auth/server-info')) return Response.json({ serverId: SERVER_ID });
        if (url.endsWith('/api/auth/pair/complete')) return sessionResponse();
        const nonce = nonceOf(init);
        if (nonce) {
          if (spent.has(nonce)) {
            return Response.json({ error: { code: 'INVALID_PROOF' } }, { status: 401 });
          }
          spent.add(nonce);
          return Response.json({ ok: true });
        }
        if (!challenged) {
          challenged = true; // one delayed proof, e.g. after the laptop slept
          return Response.json({ error: { code: 'NONCE_REQUIRED' } }, {
            status: 401,
            headers: { 'www-authenticate': 'DPoP error="use_dpop_nonce"', 'dpop-nonce': 'nonce-1' },
          });
        }
        return Response.json({ ok: true });
      }),
    });
    await runtime.completePairing({
      endpoint: 'http://127.0.0.1:3100',
      serverId: SERVER_ID,
      pairingToken: 'pairing-secret',
      deviceName: 'Desktop',
      platform: 'desktop',
    });

    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await runtime.fetch('/api/chats')).status);
    expect(statuses).toEqual([200, 200, 200]);
    expect([...spent]).toEqual(['nonce-1']);
  });
});

describe('AuthenticatedClientRuntime launch retry', () => {
  it('leaves the error state on retryInitialize once the host is reachable again', async () => {
    let online = true;
    const keyStore = new MemoryDeviceKeyStore();
    const sessionStore = new MemorySessionStore();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!online) throw new Error('network unavailable');
      if (url.endsWith('/api/auth/server-info')) return Response.json({ serverId: SERVER_ID });
      if (url.endsWith('/api/auth/pair/complete') || url.endsWith('/api/auth/token/refresh')) {
        return sessionResponse();
      }
      return Response.json({ ok: true });
    });
    const pairing = new AuthenticatedClientRuntime({ endpoint: 'http://127.0.0.1:3100', keyStore, sessionStore, fetchImpl });
    await pairing.completePairing({
      endpoint: 'http://127.0.0.1:3100',
      serverId: SERVER_ID,
      pairingToken: 'pairing-secret',
      deviceName: 'Phone',
      platform: 'mobile',
    });

    // App relaunch while the host is unreachable.
    online = false;
    const relaunched = new AuthenticatedClientRuntime({ endpoint: 'http://127.0.0.1:3100', keyStore, sessionStore, fetchImpl });
    expect((await relaunched.initialize()).status).toBe('error');
    // Memoised: a plain initialize() keeps reporting the launch failure.
    online = true;
    expect((await relaunched.initialize()).status).toBe('error');
    expect((await relaunched.retryInitialize()).status).toBe('authenticated');
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  AuthenticatedClientRuntime,
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

  it('clears persisted credentials when a request-time refresh is rejected', async () => {
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

    await expect(runtime.fetch('/api/projects')).rejects.toBeInstanceOf(DeviceRevokedError);
    expect(await sessionStore.load()).toBeNull();
    expect(runtime.currentState.status).toBe('revoked');
  });
});
// D-119 — DNS rebinding. A page on `evil.example` that re-points its name at
// 127.0.0.1 talks to this server as a same-origin page; only the Host header
// gives it away. Every listener refuses a Host that is not one of this
// server's names, public routes and WebSocket upgrades included.

import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  buildHostAllowlist,
  createHostAllowlistMiddleware,
  hostnameOfHeader,
  isHostAllowed,
  resetHostAllowlistCache,
  serverHostAllowlist,
} from '../middleware/hostAllowlist.js';
import { parseTrustProxy } from '../network/requestOrigin.js';

const LOOPBACK = buildHostAllowlist({ bindHost: '127.0.0.1', hostname: 'Studio-Mac.local', env: {} });
const LAN = buildHostAllowlist({
  bindHost: '0.0.0.0',
  hostname: 'studio-mac',
  certificateNames: ['studio-mac.local', 'localhost', '192.168.1.20', 'studio-mac.tail1234.ts.net'],
  env: { GENERATORAI_ADVERTISED_URL: 'https://gen.example.org', GENERATORAI_ALLOWED_HOSTS: 'box.home.arpa, .corp.example' },
});

describe('hostnameOfHeader', () => {
  it.each([
    ['127.0.0.1:3100', '127.0.0.1'],
    ['LOCALHOST:5173', 'localhost'],
    ['[::1]:3100', '::1'],
    ['[fd00::5]', 'fd00::5'],
    ['studio-mac.local.', 'studio-mac.local'],
    ['evil.example', 'evil.example'],
  ])('%s → %s', (raw, expected) => {
    expect(hostnameOfHeader(raw)).toBe(expected);
  });

  it.each(['', 'a:b:c', 'host:port', '[::1', '[::1]x', 'x:999999'])('rejects malformed %j', (raw) => {
    expect(hostnameOfHeader(raw)).toBeNull();
  });
});

describe('isHostAllowed', () => {
  it('refuses a rebinding name on a loopback server, and on a LAN server', () => {
    for (const host of ['evil.example', 'evil.example:3100', 'attacker.localhost.evil.example', '127.0.0.1.nip.io']) {
      expect(isHostAllowed(host, LOOPBACK), host).toBe(false);
      expect(isHostAllowed(host, LAN), host).toBe(false);
    }
  });

  it('allows loopback names, IP literals and this computer', () => {
    for (const host of ['localhost:3100', 'app.localhost', '127.0.0.1:3100', '[::1]:3100', '192.168.1.20:3100', 'studio-mac', 'studio-mac.local:3100', undefined]) {
      expect(isHostAllowed(host, LOOPBACK), String(host)).toBe(true);
    }
  });

  it('a LAN server also answers to advertised, certificate and configured names', () => {
    for (const host of ['gen.example.org', 'studio-mac.tail1234.ts.net', 'box.home.arpa', 'a.corp.example', 'studio-mac.lan:3100']) {
      expect(isHostAllowed(host, LAN), host).toBe(true);
    }
  });

  it('only a LAN-exposed server accepts its hostname in another zone', () => {
    expect(isHostAllowed('studio-mac.lan', LOOPBACK)).toBe(false);
    expect(isHostAllowed('studio-mac.lan', LAN)).toBe(true);
  });

  it('GENERATORAI_ALLOWED_HOSTS=* turns the check off', () => {
    const any = buildHostAllowlist({ bindHost: '127.0.0.1', hostname: 'h', env: { GENERATORAI_ALLOWED_HOSTS: '*' } });
    expect(isHostAllowed('evil.example', any)).toBe(true);
  });
});

describe('the middleware', () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
    resetHostAllowlistCache();
  });

  async function serve(policy = parseTrustProxy(undefined)) {
    const onReject = vi.fn();
    const app = express();
    app.use(createHostAllowlistMiddleware({ allowlist: () => LOOPBACK, policy, onReject }));
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    app.post('/api/auth/pair/preview', (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise((r) => server.once('listening', r));
    return { port: (server.address() as AddressInfo).port, onReject };
  }

  function get(port: number, path: string, host: string, method = 'GET') {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host } }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('a rebinding-style request (Host: evil.example → 127.0.0.1) gets 421 HOST_NOT_ALLOWED, even on public routes', async () => {
    const { port, onReject } = await serve();
    for (const [path, method] of [['/api/health', 'GET'], ['/api/auth/pair/preview', 'POST'], ['/', 'GET']] as const) {
      const res = await get(port, path, `evil.example:${port}`, method);
      expect(res.status, path).toBe(421);
      expect(JSON.parse(res.body).error.code).toBe('HOST_NOT_ALLOWED');
    }
    expect(onReject).toHaveBeenCalled();
  });

  it('the desktop window, a local browser and the LAN IP still work', async () => {
    const { port } = await serve();
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `192.168.1.20:${port}`]) {
      expect((await get(port, '/api/health', host)).status, host).toBe(200);
    }
  });

  it('a trusted proxy on this machine (D-114) does its own host routing', async () => {
    const { port } = await serve(parseTrustProxy('loopback'));
    expect((await get(port, '/api/health', 'gen.example.org')).status).toBe(200);
  });
});

describe('serverHostAllowlist', () => {
  afterEach(() => resetHostAllowlistCache());

  it('includes the served certificate names', () => {
    const allowlist = serverHostAllowlist({
      security: {
        posture: { bindHost: '0.0.0.0' },
        tls: { version: 1, status: () => ({ names: ['studio.tailnet.ts.net', '10.0.0.4'] }), extraHostnames: () => [] },
      },
    });
    expect(isHostAllowed('studio.tailnet.ts.net', allowlist)).toBe(true);
    expect(isHostAllowed('evil.example', allowlist)).toBe(false);
  });
});

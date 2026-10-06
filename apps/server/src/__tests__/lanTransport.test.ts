// ────────────────────────────────────────────────────────────────
// One port, two protocols — the dual listener, scheme-aware request URLs,
// proxy trust, the plain-HTTP transport policy and https endpoints
// (D-111, D-112, D-114).
// ────────────────────────────────────────────────────────────────

import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { createSecureContext } from 'node:tls';
import type { NetworkInterfaceInfo } from 'node:os';
import express from 'express';
import request from 'supertest';
import { WebSocketServer, WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalHtu } from '@generatorai/auth';
import { generateLocalCa, issueLeafCertificate, type CertificateKeyPair } from '../network/tls/certificates.js';
import { createDualProtocolListener } from '../network/tls/dualProtocolListener.js';
import { parseTrustProxy, requestAbsoluteUrl, requestOrigin, isTrustedProxyPeer } from '../network/requestOrigin.js';
import { classifyTransport, createTransportPolicyMiddleware } from '../middleware/transportPolicy.js';
import { resolveAdvertisedEndpoints } from '../network/advertisedEndpoints.js';

let ca: CertificateKeyPair;
let leaf: CertificateKeyPair;
let listener: net.Server;
let httpServer: http.Server;
let port: number;

beforeAll(async () => {
  ca = await generateLocalCa({ commonName: 'GeneratorAI local CA (test)' });
  leaf = await issueLeafCertificate({
    ca,
    names: { dnsNames: ['localhost'], ipAddresses: ['127.0.0.1'] },
    commonName: 'localhost',
  });
  const context = createSecureContext({ key: leaf.keyPem, cert: leaf.certPem + ca.certPem });

  const app = express();
  app.use(express.json());
  app.post('/echo', (req, res) => {
    res.json({
      secure: req.secure,
      htu: requestAbsoluteUrl(req, req.originalUrl),
      body: req.body,
    });
  });
  httpServer = http.createServer(app);
  // The upgrade handler sits on the http.Server, exactly as the terminal and
  // browser streams do, and must serve both kinds of socket.
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => ws.send(`hello ${(req.socket as { encrypted?: boolean }).encrypted ? 'tls' : 'plain'}`));
  });
  listener = createDualProtocolListener({ httpServer, secureContext: () => context });
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  port = (listener.address() as net.AddressInfo).port;
});

afterAll(async () => {
  httpServer.closeAllConnections();
  await new Promise<void>((resolve) => listener.close(() => resolve()));
});

function post(client: typeof http | typeof https, body: string, chunked: boolean): Promise<{ secure: boolean; htu: string; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/echo?x=1',
        headers: { 'content-type': 'application/json', ...(chunked ? {} : { 'content-length': Buffer.byteLength(body) }) },
        ...(client === https ? { ca: ca.certPem } : {}),
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve(JSON.parse(text)));
      },
    );
    req.on('error', reject);
    // Send the body in pieces after the headers, so it arrives in later
    // packets than the request line the listener sniffed.
    const half = Math.floor(body.length / 2);
    req.write(body.slice(0, half));
    setTimeout(() => req.end(body.slice(half)), 20);
  });
}

describe('dual-protocol listener (D-111)', () => {
  it('serves plain HTTP on the port, with the body intact across packets', async () => {
    const result = await post(http, JSON.stringify({ hello: 'world', pad: 'x'.repeat(5000) }), true);
    expect(result.secure).toBe(false);
    expect(result.htu).toBe(`http://127.0.0.1:${port}/echo?x=1`);
    expect(result.body).toMatchObject({ hello: 'world' });
  });

  it('serves HTTPS on the same port; Express sees req.secure and the htu is https://', async () => {
    const result = await post(https, JSON.stringify({ hello: 'tls', pad: 'y'.repeat(5000) }), false);
    expect(result.secure).toBe(true);
    expect(result.htu).toBe(`https://127.0.0.1:${port}/echo?x=1`);
    expect(result.body).toMatchObject({ hello: 'tls' });
    // The DPoP verifier compares canonical forms; https and http never collide.
    expect(canonicalHtu(result.htu)).not.toBe(canonicalHtu(result.htu.replace('https:', 'http:')));
  });

  it('upgrades WebSockets over both protocols through the one http.Server', async () => {
    const receive = (url: string, options: object) =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(url, options);
        ws.on('message', (data) => {
          resolve(String(data));
          ws.close();
        });
        ws.on('error', reject);
      });
    await expect(receive(`ws://127.0.0.1:${port}/s`, {})).resolves.toBe('hello plain');
    await expect(receive(`wss://127.0.0.1:${port}/s`, { ca: ca.certPem })).resolves.toBe('hello tls');
  });

  it('drops a client that stalls mid-handshake or sends nothing, and keeps serving', async () => {
    const quick = createDualProtocolListener({
      httpServer,
      secureContext: () => createSecureContext({ key: leaf.keyPem, cert: leaf.certPem }),
      firstByteTimeoutMs: 200,
      handshakeTimeoutMs: 200,
    });
    await new Promise<void>((resolve) => quick.listen(0, '127.0.0.1', resolve));
    const quickPort = (quick.address() as net.AddressInfo).port;
    const closed = async (bytes?: Buffer) => {
      const socket = net.connect(quickPort, '127.0.0.1');
      await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
      // Drain whatever the server answers (a TLS alert), or 'close' never fires.
      socket.resume();
      if (bytes) socket.write(bytes);
      await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    };
    // A TLS record header announcing a ClientHello that never arrives.
    await closed(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x05, 1, 2, 3, 4, 5]));
    // A socket that never sends a byte.
    await closed();
    await new Promise<void>((resolve) => quick.close(() => resolve()));
    // The main listener still serves.
    const result = await post(http, '{"ok":true}', false);
    expect(result.body).toEqual({ ok: true });
  });
});

describe('request origin and proxy trust (D-114)', () => {
  const req = (remoteAddress: string, headers: Record<string, string>, encrypted = false) => ({
    socket: { remoteAddress, encrypted },
    headers,
  });

  it('parses GENERATORAI_TRUST_PROXY', () => {
    expect(parseTrustProxy(undefined)).toEqual({ mode: 'off' });
    expect(parseTrustProxy('0')).toEqual({ mode: 'off' });
    expect(parseTrustProxy('1')).toEqual({ mode: 'loopback' });
    expect(parseTrustProxy('loopback')).toEqual({ mode: 'loopback' });
    const list = parseTrustProxy('192.168.1.5, ::ffff:10.0.0.2');
    expect(list.mode).toBe('addresses');
    expect(isTrustedProxyPeer(list, '::ffff:192.168.1.5')).toBe(true);
    expect(isTrustedProxyPeer(list, '10.0.0.2')).toBe(true);
    expect(isTrustedProxyPeer(list, '127.0.0.1')).toBe(false);
  });

  it('ignores forwarded headers unless the peer is a trusted proxy', () => {
    const forged = req('192.168.1.9', { host: '192.168.1.20:3100', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example' });
    expect(requestOrigin(forged, parseTrustProxy('loopback'))).toEqual({ scheme: 'http', host: '192.168.1.20:3100', forwarded: false });
    expect(requestOrigin(forged, parseTrustProxy('off')).scheme).toBe('http');

    const proxied = req('127.0.0.1', { host: '127.0.0.1:3100', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'box.tail1.ts.net' });
    expect(requestAbsoluteUrl(proxied, '/api/x', parseTrustProxy('loopback'))).toBe('https://box.tail1.ts.net/api/x');
    expect(requestAbsoluteUrl(proxied, '/api/x', parseTrustProxy('off'))).toBe('http://127.0.0.1:3100/api/x');
  });

  it('uses https for a TLS socket regardless of headers', () => {
    expect(requestAbsoluteUrl(req('192.168.1.9', { host: '192.168.1.20:3100', 'x-forwarded-proto': 'http' }, true), '/a')).toBe(
      'https://192.168.1.20:3100/a',
    );
  });
});

describe('plain-HTTP transport policy (D-111, D-112)', () => {
  const host = '192.168.1.20:3100';
  const lane = (remoteAddress: string, headers: Record<string, string>, encrypted = false) =>
    classifyTransport({ socket: { remoteAddress, encrypted }, headers: { host, ...headers } }, parseTrustProxy('off'));

  it('classifies requests into lanes', () => {
    expect(lane('192.168.1.9', {}, true)).toBe('https');
    expect(lane('127.0.0.1', { origin: 'http://localhost:5173' })).toBe('loopback');
    expect(lane('192.168.1.9', {})).toBe('native-lan');
    // React Native's WebSocket default Origin — the server's own http origin.
    expect(lane('192.168.1.9', { origin: `http://${host}` })).toBe('native-lan');
    expect(lane('192.168.1.9', { origin: 'https://evil.example' })).toBe('browser-lan');
    expect(lane('192.168.1.9', { origin: `http://evil.example:3100` })).toBe('browser-lan');
  });

  function appWithPolicy(tlsActive: boolean) {
    const app = express();
    app.use(createTransportPolicyMiddleware({ tlsActive: () => tlsActive, policy: parseTrustProxy('off') }));
    app.all('/{*path}', (_req, res) => res.json({ ok: true }));
    return app;
  }

  // supertest connects from loopback, so these exercise the decision through
  // a forwarded remote address the policy cannot see; instead drive a real
  // non-loopback request shape through the middleware directly.
  function run(tlsActive: boolean, init: { method: string; url: string; headers: Record<string, string>; remoteAddress: string }) {
    return new Promise<{ status: number; location?: string; body?: unknown }>((resolve) => {
      const reqLike = {
        method: init.method,
        url: init.url,
        originalUrl: init.url,
        path: init.url.split('?')[0],
        headers: { host, ...init.headers },
        socket: { remoteAddress: init.remoteAddress, encrypted: false },
      };
      const res = {
        statusCode: 200,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        redirect(code: number, location: string) {
          resolve({ status: code, location });
        },
        json(body: unknown) {
          resolve({ status: this.statusCode, body });
        },
      };
      createTransportPolicyMiddleware({ tlsActive: () => tlsActive, policy: parseTrustProxy('off') })(
        reqLike as never,
        res as never,
        () => resolve({ status: 0 }),
      );
    });
  }

  it('redirects a LAN browser navigation to https://, same path', async () => {
    await expect(run(true, { method: 'GET', url: '/settings?x=1', headers: { accept: 'text/html' }, remoteAddress: '192.168.1.9' })).resolves.toEqual({
      status: 308,
      location: `https://${host}/settings?x=1`,
    });
  });

  it('refuses a LAN browser API call over plain HTTP with HTTPS_REQUIRED', async () => {
    const result = await run(true, { method: 'POST', url: '/api/auth/pair/complete', headers: { origin: `http://evil.example:3100` }, remoteAddress: '192.168.1.9' });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: 'HTTPS_REQUIRED' } });
    expect(JSON.stringify(result.body)).toContain(`https://${host}`);
  });

  it('lets the native lane, this machine and https through; does nothing while TLS is off', async () => {
    await expect(run(true, { method: 'POST', url: '/api/chats', headers: {}, remoteAddress: '192.168.1.9' })).resolves.toEqual({ status: 0 });
    await expect(run(true, { method: 'GET', url: '/', headers: {}, remoteAddress: '127.0.0.1' })).resolves.toEqual({ status: 0 });
    await expect(run(false, { method: 'GET', url: '/', headers: { origin: 'https://evil.example' }, remoteAddress: '192.168.1.9' })).resolves.toEqual({ status: 0 });
    // The native lane covers the API only; a page is still redirected.
    await expect(run(true, { method: 'GET', url: '/', headers: {}, remoteAddress: '192.168.1.9' })).resolves.toMatchObject({ status: 308 });
  });

  it('leaves loopback traffic alone end to end', async () => {
    const res = await request(appWithPolicy(true)).get('/anything');
    expect(res.status).toBe(200);
  });
});

describe('advertised endpoints with TLS', () => {
  const iface = (address: string): NetworkInterfaceInfo => ({
    address,
    family: 'IPv4',
    internal: false,
    netmask: '255.255.255.0',
    mac: '00:00:00:00:00:00',
    cidr: `${address}/24`,
  });

  it('advertises https:// LAN addresses and <host>.local for browsers, keeps loopback http', () => {
    const endpoints = resolveAdvertisedEndpoints({
      port: 3100,
      bindHost: '0.0.0.0',
      networkInterfaces: { en0: [iface('192.168.1.20')] },
      lanScheme: 'https',
      hostnames: ['box.local'],
    });
    expect(endpoints.map((e) => [e.origin, e.reachability, e.secure])).toEqual([
      ['https://192.168.1.20:3100', 'lan', true],
      ['https://box.local:3100', 'lan', true],
      ['http://127.0.0.1:3100', 'loopback', false],
    ]);
  });

  it('keeps plain http LAN addresses for the native lane', () => {
    const endpoints = resolveAdvertisedEndpoints({
      port: 3100,
      bindHost: '0.0.0.0',
      networkInterfaces: { en0: [iface('192.168.1.20')] },
      lanScheme: 'http',
    });
    expect(endpoints[0]?.origin).toBe('http://192.168.1.20:3100');
  });
});

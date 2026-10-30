// ────────────────────────────────────────────────────────────────
// Audit F-2 — revoking a device ends its ALREADY-OPEN streams.
//
// REST re-reads the device on every request; an SSE stream or a WebSocket is
// authorised once, at open time. Before the fix a revoked device kept
// receiving `chat.*` events on a stream it opened earlier. These tests drive
// the real stream route and a real `DeviceService`, wired exactly as
// `composition/security.ts` wires them, and assert the stream ends within
// ~1 s of the revocation and delivers nothing after it.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

import { DeviceService, type DeviceRecord, type IDeviceRepository, type Principal, type Scope } from '@generatorai/auth';
import type { StreamEventRow } from '@generatorai/core';

import { createUnifiedStreamRoutes } from '../routes/stream.js';
import { resetConnectionRegistry } from '../streaming/streamConnectionRegistry.js';
import { liveConnections, trackWebSocket, WS_CLOSE_ACCESS_ENDED } from '../streaming/liveConnections.js';

type Deliver = (row: StreamEventRow) => void | Promise<void>;

function fakeBroker() {
  const handlers = new Map<string, Set<Deliver>>();
  let seq = 0;
  return {
    handlers,
    streamSpaceId: async () => 'space-1',
    replay: async () => [],
    publish: vi.fn(),
    subscribe: vi.fn(async (scope: string, scopeId: string, handler: Deliver, opts: Record<string, unknown> = {}) => {
      const key = `${scope}:${scopeId}`;
      const set = handlers.get(key) ?? new Set<Deliver>();
      set.add(handler);
      handlers.set(key, set);
      (opts['onResume'] as ((s: unknown) => void) | undefined)?.({ resumed: true, oldestSeq: 0, deliveredUpTo: 0 });
      return () => {
        set.delete(handler);
      };
    }),
    emit(scope: string, scopeId: string, kind: string): void {
      seq += 1;
      const row = { scope, scopeId, kind, payload: { n: seq }, seq, id: seq, ts: Date.now() } as unknown as StreamEventRow;
      for (const h of handlers.get(`${scope}:${scopeId}`) ?? []) void h(row);
    },
  };
}

function deviceRecord(deviceId: string, scopes: Scope[]): DeviceRecord {
  return {
    deviceId,
    ownerId: 'local',
    name: deviceId,
    platform: 'web',
    publicJwk: '{}',
    jwkThumbprint: `t-${deviceId}`,
    scopes,
    createdAt: Date.now(),
    lastSeenAt: null,
    lastSeenTransport: null,
    revokedAt: null,
    revokedReason: null,
    credentialVersion: 1,
    previousCredentialGraceUntil: null,
    connectionMode: 'auto',
    relayBinding: null,
  };
}

function deviceRepo(records: DeviceRecord[]): IDeviceRepository {
  const byId = new Map(records.map((r) => [r.deviceId, r]));
  return {
    create: async () => undefined,
    findById: async (id: string) => (byId.has(id) ? { ...byId.get(id)! } : null),
    findByThumbprint: async () => null,
    list: async () => [...byId.values()],
    update: async (id: string, patch: Partial<DeviceRecord>) => {
      const r = byId.get(id);
      if (r) Object.assign(r, patch);
    },
    revoke: async (id: string, reason: string, at: number) => {
      const r = byId.get(id);
      if (r) Object.assign(r, { revokedAt: at, revokedReason: reason });
    },
    touch: async () => undefined,
    createCredential: async () => undefined,
    findCredentialByHash: async () => null,
    listCredentials: async () => [],
    revokeCredentials: async () => undefined,
    markCredentialUsed: async () => undefined,
  } as unknown as IDeviceRepository;
}

const WEB_SCOPES: Scope[] = ['stream:events', 'read:chats', 'write:chats', 'read:status'];
const ADMIN: Principal = { type: 'service-account', id: 'admin', scopes: ['admin:devices'], transport: 'loopback' };

function devicePrincipal(deviceId: string, scopes: Scope[]): Principal {
  return { type: 'paired-device', id: deviceId, deviceId, scopes, transport: 'lan', credentialKind: 'access-token' };
}

let broker: ReturnType<typeof fakeBroker>;
let devices: DeviceService;
let offAccess: () => void;
const servers: Server[] = [];
const aborts: AbortController[] = [];

beforeEach(() => {
  resetConnectionRegistry();
  liveConnections.reset();
  broker = fakeBroker();
  devices = new DeviceService({
    devices: deviceRepo([deviceRecord('dev-x', [...WEB_SCOPES]), deviceRecord('dev-y', [...WEB_SCOPES])]),
    pairing: {} as never,
    tokens: {} as never,
    audit: { record: vi.fn() } as never,
  });
  // Exactly the composition-root wiring.
  offAccess = devices.onAccessChanged((change) => liveConnections.apply(change));
});

afterEach(async () => {
  offAccess();
  for (const a of aborts.splice(0)) a.abort();
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  liveConnections.reset();
});

async function listen(principalFor: (req: express.Request) => Principal): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = principalFor(req);
    next();
  });
  app.use(
    '/api/stream',
    createUnifiedStreamRoutes({
      streamBroker: broker,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: { streaming: { heartbeatIntervalMs: 60_000 } },
      security: { auth: { issueStreamTicket: vi.fn(async () => ({ ticket: 'tkt', expiresAt: Date.now() + 30_000 })) } },
    } as never),
  );
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

interface Stream {
  events: string[];
  ended: Promise<number>;
}

/** Opens an SSE stream; `events` collects every frame's event name (`message` for data). */
async function open(url: string): Promise<Stream> {
  const abort = new AbortController();
  aborts.push(abort);
  const res = await fetch(url, { headers: { accept: 'text/event-stream' }, signal: abort.signal });
  expect(res.status).toBe(200);
  const events: string[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const ended = (async () => {
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (block.startsWith(':')) continue;
          const name = /^event: (.+)$/m.exec(block)?.[1] ?? 'message';
          events.push(name);
        }
      }
    } catch {
      /* socket destroyed */
    }
    return Date.now();
  })();
  return { events, ended };
}

const within = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`not within ${ms} ms`)), ms))]);

describe('device revocation closes live streams (F-2)', () => {
  it('a single-scope SSE stream of the revoked device ends within ~1 s and receives nothing after', async () => {
    const base = await listen((req) =>
      devicePrincipal(req.headers['x-device'] === 'y' ? 'dev-y' : 'dev-x', WEB_SCOPES),
    );
    const x = await open(`${base}/api/stream?scope=chat&id=c1`);
    const yAbort = new AbortController();
    aborts.push(yAbort);
    const yRes = await fetch(`${base}/api/stream?scope=chat&id=c2`, { headers: { 'x-device': 'y' }, signal: yAbort.signal });
    expect(yRes.status).toBe(200);

    await vi.waitFor(() => expect(broker.handlers.get('chat:c1')?.size).toBe(1));
    broker.emit('chat', 'c1', 'chat.updated');
    await vi.waitFor(() => expect(x.events).toContain('message'));
    expect(liveConnections.countForDevice('dev-x')).toBe(1);

    const revokedAt = Date.now();
    await devices.revokeDevice('dev-x', 'lost laptop', ADMIN);
    const endedAt = await within(x.ended, 1_500);
    expect(endedAt - revokedAt).toBeLessThan(1_500);

    // Unsubscribed from the broker: nothing published afterwards can reach it.
    expect(broker.handlers.get('chat:c1')?.size ?? 0).toBe(0);
    const before = x.events.filter((e) => e === 'message').length;
    broker.emit('chat', 'c1', 'chat.created');
    await new Promise((r) => setTimeout(r, 50));
    expect(x.events.filter((e) => e === 'message').length).toBe(before);
    expect(x.events).toContain('access-ended');

    // Another device's stream is untouched.
    expect(liveConnections.countForDevice('dev-y')).toBe(1);
    expect(broker.handlers.get('chat:c2')?.size).toBe(1);
  });

  it('a multiplexed stream of the revoked device ends too', async () => {
    const base = await listen(() => devicePrincipal('dev-x', WEB_SCOPES));
    const created = await request(base).post('/api/stream/connections').send({ subs: [{ scope: 'chat', id: 'c1' }] });
    expect(created.status).toBe(201);
    const x = await open(`${base}/api/stream?c=${created.body.connectionId as string}`);
    await vi.waitFor(() => expect(x.events).toContain('hello'));

    await devices.revokeDevice('dev-x', 'lost', ADMIN);
    await within(x.ended, 1_500);
    expect(broker.handlers.get('chat:c1')?.size ?? 0).toBe(0);
  });

  it('credential rotation ends the stream so it must re-authenticate', async () => {
    const base = await listen(() => devicePrincipal('dev-x', WEB_SCOPES));
    const x = await open(`${base}/api/stream?scope=chat&id=c1`);
    await vi.waitFor(() => expect(liveConnections.countForDevice('dev-x')).toBe(1));
    await devices.rotateCredentials('dev-x', ADMIN);
    await within(x.ended, 1_500);
  });

  it('a scope cut closes only the streams that relied on the removed scope', async () => {
    const base = await listen(() => devicePrincipal('dev-x', WEB_SCOPES));
    const x = await open(`${base}/api/stream?scope=chat&id=c1`);
    await vi.waitFor(() => expect(liveConnections.countForDevice('dev-x')).toBe(1));

    // Dropping write:chats does not touch a read-only chat feed…
    await devices.updateDeviceScopes('dev-x', ['stream:events', 'read:chats', 'read:status'], {
      ...ADMIN,
      scopes: [...WEB_SCOPES, 'admin:devices'],
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(liveConnections.countForDevice('dev-x')).toBe(1);

    // …dropping stream:events (or read:chats) ends it.
    await devices.updateDeviceScopes('dev-x', ['read:chats', 'read:status'], {
      ...ADMIN,
      scopes: [...WEB_SCOPES, 'admin:devices'],
    });
    await within(x.ended, 1_500);
    expect(liveConnections.countForDevice('dev-x')).toBe(0);
  });

  it('a tracked WebSocket of the revoked device is closed with 4401', async () => {
    const server = createServer();
    servers.push(server);
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws) => trackWebSocket(devicePrincipal('dev-x', WEB_SCOPES), ws, 'test-ws', ['read:chats']));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await new Promise((r) => client.once('open', r));
    await vi.waitFor(() => expect(liveConnections.countForDevice('dev-x')).toBe(1));

    const closed = new Promise<number>((r) => client.once('close', (code) => r(code)));
    await devices.revokeDevice('dev-x', 'lost', ADMIN);
    expect(await within(closed, 1_500)).toBe(WS_CLOSE_ACCESS_ENDED);
    await vi.waitFor(() => expect(liveConnections.countForDevice('dev-x')).toBe(0));
    wss.close();
  });
});

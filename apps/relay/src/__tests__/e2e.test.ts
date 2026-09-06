// ────────────────────────────────────────────────────────────────
// End-to-end: the REAL relay (director + cell) ↔ the REAL host connector.
//
// Until this test existed the two sides had never been run against each
// other: `RelayHostBroker` called `POST /v1/hosts/register` and dialled
// `/v1/host`, routes the relay never served, and the cell minted stream ids
// (`invite:<uuid>`) that the host's strict schema rejected. `cell.test.ts`
// speaks the protocol by hand and so could not notice either.
//
// This test boots `createRelayApp` on an ephemeral port, points the server's
// `RelayHostBroker` + `RelayStreamBridge` at it (with a loopback HTTP echo
// standing in for the GeneratorAI API), pairs a client through an invite, and
// pushes an HTTP request through phone → cell → host → local server and the
// response back. If any route, schema or id format disagrees, it fails here.
// ────────────────────────────────────────────────────────────────

import { createServer, type Server } from 'node:http';
import * as crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import {
  RELAY_PROTOCOL_VERSION,
  RelayAssignmentSchema,
  RelayStreamIdSchema,
  canonicalRelayOrigin,
  relayAssignmentUrl,
  relayClientSocketUrl,
} from '@generatorai/relay-protocol';

import { createRelayApp, type RelayApp } from '../app.js';
// The host side lives in apps/server. Imported by path (not by package) so
// this test needs no extra workspace dependency; its own imports resolve from
// apps/server/node_modules exactly as they do in production.
import { RelayHostBroker } from '../../../server/src/relay/RelayHostBroker.js';
import { RelayStreamBridge } from '../../../server/src/relay/RelayStreamBridge.js';

// ── fixtures ──────────────────────────────────────────────────────

/** Same shape `keyPairFromEd25519Seed` builds, without importing @generatorai/auth here. */
function signingKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x?: string };
  return {
    privateKey,
    publicKey,
    publicJwk: { kty: 'OKP' as const, crv: 'Ed25519' as const, x: String(jwk.x) },
    thumbprint: 'test',
  };
}

function fakeSecurity(hostId: string) {
  return {
    identity: { hostId },
    deviceRepo: { list: async () => [] },
    audit: { record: () => undefined },
    relayOutboxRepo: {
      listPending: async () => [],
      remove: async () => undefined,
      markAttempt: async () => undefined,
    },
  };
}

const warnings: string[] = [];
const logger = {
  info: () => undefined,
  warn: (message: string, meta?: unknown) => {
    warnings.push(`${message} ${meta ? JSON.stringify(meta) : ''}`);
  },
  error: () => undefined,
  debug: () => undefined,
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  );
}
function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

let relayServer: Server;
let relay: RelayApp;
let relayOrigin: string;
let localServer: Server;
let localPort: number;
let broker: RelayHostBroker;
let bridge: RelayStreamBridge;
let hostId: string;

beforeEach(async () => {
  warnings.length = 0;

  // The relay: listen first so the advertised origin is the real address.
  relayServer = createServer();
  const relayPort = await listen(relayServer);
  relayOrigin = `http://127.0.0.1:${relayPort}`;
  relay = createRelayApp({ origin: relayOrigin, log: () => undefined });
  relayServer.on('request', relay.app);
  relay.attach(relayServer);

  // The "GeneratorAI API" the host bridges streams into.
  localServer = createServer((req, res) => {
    res.setHeader('content-type', 'text/plain');
    res.end(`echo:${req.method}:${req.url}`);
  });
  localPort = await listen(localServer);

  // The host connector, wired exactly as composition-root.ts does it.
  hostId = Buffer.from(crypto.randomBytes(32)).toString('base64url');
  broker = new RelayHostBroker({
    security: fakeSecurity(hostId) as never,
    logger: logger as never,
    enabled: true,
    directorUrl: relayOrigin,
    signingKey: signingKeyPair(),
  });
  bridge = new RelayStreamBridge({ logger: logger as never, localPort });
  broker.setStreamBridge(bridge);
  await broker.start();
});

afterEach(async () => {
  await broker.stop();
  bridge.closeAll('test over');
  relay.cell.close();
  await close(localServer);
  await close(relayServer);
});

// ── tests ─────────────────────────────────────────────────────────

describe('relay ↔ host connector end to end', () => {
  it('the director answers the route the host actually calls, with canonical origins', async () => {
    const response = await fetch(relayAssignmentUrl(relayOrigin, hostId));
    expect(response.status).toBe(200);
    const parsed = RelayAssignmentSchema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.v).toBe(RELAY_PROTOCOL_VERSION);
    expect(parsed.data.relayHostId).toBe(hostId);
    // Bare origins, as the pairing-offer relay block requires — not `…/relay/host`.
    expect(parsed.data.cellUrl).toBe(canonicalRelayOrigin(relayOrigin));
    expect(new URL(parsed.data.cellUrl).pathname).toBe('/');
    expect(parsed.data.directorUrl).toBe(canonicalRelayOrigin(relayOrigin));
  });

  it('host attaches (assignment → hello with binding → challenge → proof) and mints an invite', async () => {
    const invite = await broker.createInvite('pending-device-1');
    expect(broker.connectionState).toBe('attached');
    expect(invite.inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invite.offer.relayHostId).toBe(hostId);
    expect(invite.offer.cellUrl).toBe(canonicalRelayOrigin(relayOrigin));
    expect(relay.cell.stats().hosts).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('pushes an HTTP request phone → cell → host → local server and the response back', async () => {
    const invite = await broker.createInvite('pending-device-2');

    const client = new WebSocket(relayClientSocketUrl(invite.offer.cellUrl));
    await waitOpen(client);

    const received: Buffer[] = [];
    const ready = new Promise<{ streamId: string }>((resolve, reject) => {
      client.once('message', (raw, isBinary) => {
        if (isBinary) return reject(new Error('expected client_ready first'));
        resolve(JSON.parse(raw.toString('utf8')) as { streamId: string });
      });
    });
    client.send(
      JSON.stringify({
        type: 'client_hello',
        v: RELAY_PROTOCOL_VERSION,
        relayHostId: hostId,
        credentialKind: 'invite',
        credential: invite.inviteToken,
      }),
    );
    const { streamId } = await ready;
    // The id the cell minted must be one the host's strict parser accepts —
    // if it were not, the broker would have closed the control channel by now.
    expect(RelayStreamIdSchema.safeParse(streamId).success).toBe(true);

    // Now speak plain HTTP over the stream, like DirectTransport would.
    const responseDone = new Promise<string>((resolve) => {
      client.on('message', (raw, isBinary) => {
        if (!isBinary) return;
        received.push(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer));
        const text = Buffer.concat(received).toString('utf8');
        if (text.includes('echo:GET:/from-phone')) resolve(text);
      });
    });
    client.send(
      Buffer.from('GET /from-phone HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'),
      { binary: true },
    );

    const text = await responseDone;
    expect(text.startsWith('HTTP/1.1 200')).toBe(true);
    expect(text).toContain('echo:GET:/from-phone');
    // `Connection: close` lets the local server end the TCP leg, and the bridge
    // tears the stream down with it — so by now the bridge is idle again while
    // the control channel is untouched.
    expect(broker.connectionState).toBe('attached');
    expect(relay.cell.stats().hosts).toBe(1);
    expect(warnings).toEqual([]);

    client.close();
  }, 20_000);
});

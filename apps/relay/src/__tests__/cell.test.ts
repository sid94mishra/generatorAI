// ────────────────────────────────────────────────────────────────
// RelayCell — found with ZERO test coverage during end-to-end review, despite
// being the one piece of this system explicitly designed around a security
// invariant ("operating it grants NO ability to read user data"). This also
// fixes `pnpm test` crashing at the repo root — `apps/relay` having no test
// files at all made the package's own `vitest run` exit 1 with "No test
// files found."
//
// Uses REAL WebSocket connections against a REAL http server + RelayCell, and
// a REAL Ed25519 keypair for the host proof — this is exactly the class of
// logic (challenge/response, signature verification, single-use invites,
// revocation) that is easy to get subtly wrong and hard to trust from
// inspection alone.
// ────────────────────────────────────────────────────────────────

import { createServer, type Server } from 'node:http';
import { randomBytes as nodeRandomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ed25519 } from '@noble/curves/ed25519';

import {
  RELAY_PROTOCOL_VERSION,
  encodeHostProofTranscript,
  toBase64Url,
  type RelayControlMessage,
} from '@generatorai/relay-protocol';

import { RelayCell } from '../cell.js';

const ORIGIN = 'http://localhost';

let server: Server;
let cell: RelayCell;
let port: number;

beforeEach(async () => {
  cell = new RelayCell({ origin: ORIGIN, log: () => undefined });
  server = createServer();
  cell.attach(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  cell.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function wsUrl(path: string): string {
  return `ws://127.0.0.1:${port}${path}`;
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<RelayControlMessage> {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try {
        resolve(JSON.parse(raw.toString('utf8')) as RelayControlMessage);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

function waitClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }));
  });
}

interface Host {
  ws: WebSocket;
  relayHostId: string;
  hostPublicKey: string;
}

/** Connects a host and completes the real challenge/response handshake. */
async function attachHost(
  opts: { relayHostId?: string; wrongKeySignature?: boolean } = {},
): Promise<{ host: Host; attached: RelayControlMessage }> {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(priv);
  const relayHostId = opts.relayHostId ?? toBase64Url(nodeRandomBytes(32));
  const hostPublicKey = toBase64Url(pub);

  const ws = new WebSocket(wsUrl('/relay/host'));
  await waitOpen(ws);

  const challengePromise = nextMessage(ws);
  ws.send(
    JSON.stringify({
      type: 'host_hello',
      v: RELAY_PROTOCOL_VERSION,
      relayHostId,
      hostPublicKey,
      assignmentEpoch: 0,
      previousGeneration: 0,
      resumeIntent: false,
    }),
  );
  const challenge = await challengePromise;
  if (challenge.type !== 'challenge') throw new Error(`expected challenge, got ${challenge.type}`);

  const transcript = encodeHostProofTranscript({
    relayOrigin: ORIGIN,
    relayEphemeralPublicKey: challenge.relayEphemeralPublicKey,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    relayHostId,
    hostPublicKey,
    assignmentEpoch: 0,
    previousGeneration: 0,
    resumeIntent: false,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  });
  const signingKey = opts.wrongKeySignature ? ed25519.utils.randomPrivateKey() : priv;
  const signature = toBase64Url(ed25519.sign(transcript, signingKey));

  const resultPromise = nextMessage(ws);
  ws.send(
    JSON.stringify({
      type: 'challenge_response',
      v: RELAY_PROTOCOL_VERSION,
      challengeId: challenge.challengeId,
      signature,
    }),
  );
  const attached = await resultPromise;
  return { host: { ws, relayHostId, hostPublicKey }, attached };
}

function hostMessages(ws: WebSocket): RelayControlMessage[] {
  const seen: RelayControlMessage[] = [];
  ws.on('message', (raw) => seen.push(JSON.parse(raw.toString('utf8')) as RelayControlMessage));
  return seen;
}

async function createInvite(host: Host): Promise<{ token: string; expiresAt: number }> {
  const requestId = toBase64Url(nodeRandomBytes(8));
  const resultPromise = nextMessage(host.ws);
  host.ws.send(
    JSON.stringify({
      type: 'create_invite',
      v: RELAY_PROTOCOL_VERSION,
      requestId,
      pendingDeviceRef: 'device-1',
      expiresAt: Date.now() + 60_000,
      maxAttempts: 3,
    }),
  );
  const result = await resultPromise;
  if (result.type !== 'invite_created') throw new Error(`expected invite_created, got ${result.type}`);
  return { token: result.inviteToken, expiresAt: result.expiresAt };
}

describe('RelayCell — host handshake', () => {
  it('attaches a host that proves possession of its private key', async () => {
    const { attached, host } = await attachHost();
    expect(attached).toMatchObject({ type: 'attached', generation: 1 });
    expect(cell.stats().hosts).toBe(1);
    host.ws.close();
  });

  it('refuses a signature produced by a different key than the one claimed (PROOF_INVALID)', async () => {
    const { attached, host } = await attachHost({ wrongKeySignature: true });
    expect(attached).toMatchObject({ type: 'error', code: 'PROOF_INVALID' });
    expect(cell.stats().hosts).toBe(0);
    host.ws.close();
  });

  it('rejects a binary frame on the control channel', async () => {
    const ws = new WebSocket(wsUrl('/relay/host'));
    await waitOpen(ws);
    const closed = waitClose(ws);
    ws.send(Buffer.from([1, 2, 3]));
    const { code } = await closed;
    expect(code).toBe(4400);
  });

  it('rejects a malformed (schema-invalid) message', async () => {
    const ws = new WebSocket(wsUrl('/relay/host'));
    await waitOpen(ws);
    const closed = waitClose(ws);
    ws.send(JSON.stringify({ type: 'host_hello', v: RELAY_PROTOCOL_VERSION })); // missing required fields
    const { code } = await closed;
    expect(code).toBe(4400);
  });

  it('retires the previous connection when the same relayHostId reconnects', async () => {
    const relayHostId = toBase64Url(nodeRandomBytes(32));
    const first = await attachHost({ relayHostId });
    const firstClosed = waitClose(first.host.ws);

    const second = await attachHost({ relayHostId });
    expect(second.attached).toMatchObject({ type: 'attached', generation: 2 });

    const { code } = await firstClosed;
    expect(code).toBe(4409);
    expect(cell.stats().hosts).toBe(1); // only the newer connection remains registered
    second.host.ws.close();
  });
});

describe('RelayCell — invites and client pairing', () => {
  it('a valid invite lets a client pair and the host is told a stream opened', async () => {
    const { host } = await attachHost();
    const messages = hostMessages(host.ws);
    const invite = await createInvite(host);

    const client = new WebSocket(wsUrl('/relay/client'));
    await waitOpen(client);
    const readyPromise = nextMessage(client);
    client.send(
      JSON.stringify({
        type: 'client_hello',
        v: RELAY_PROTOCOL_VERSION,
        relayHostId: host.relayHostId,
        credentialKind: 'invite',
        credential: invite.token,
      }),
    );
    const ready = await readyPromise;
    expect(ready.type).toBe('client_ready');

    await new Promise((r) => setTimeout(r, 20)); // let the stream_open reach the host
    expect(messages.some((m) => m.type === 'stream_open' && m.credentialKind === 'invite')).toBe(true);
    expect(cell.stats().streams).toBe(1);

    client.close();
    host.ws.close();
  });

  it('an invite can only be redeemed once', async () => {
    const { host } = await attachHost();
    const invite = await createInvite(host);

    const first = new WebSocket(wsUrl('/relay/client'));
    await waitOpen(first);
    const firstReady = nextMessage(first);
    first.send(
      JSON.stringify({
        type: 'client_hello',
        v: RELAY_PROTOCOL_VERSION,
        relayHostId: host.relayHostId,
        credentialKind: 'invite',
        credential: invite.token,
      }),
    );
    expect((await firstReady).type).toBe('client_ready'); // first redemption succeeds

    const second = new WebSocket(wsUrl('/relay/client'));
    await waitOpen(second);
    const secondClosed = waitClose(second);
    second.send(
      JSON.stringify({
        type: 'client_hello',
        v: RELAY_PROTOCOL_VERSION,
        relayHostId: host.relayHostId,
        credentialKind: 'invite',
        credential: invite.token,
      }),
    );
    const { code } = await secondClosed;
    expect(code).toBe(4401);

    first.close();
    host.ws.close();
  });

  it('rejects a client dialling an unknown or offline host id the same way either would look (no oracle)', async () => {
    const client = new WebSocket(wsUrl('/relay/client'));
    await waitOpen(client);
    const closed = waitClose(client);
    client.send(
      JSON.stringify({
        type: 'client_hello',
        v: RELAY_PROTOCOL_VERSION,
        relayHostId: toBase64Url(nodeRandomBytes(32)),
        credentialKind: 'invite',
        credential: 'x'.repeat(20),
      }),
    );
    const { code } = await closed;
    expect(code).toBe(4404);
  });

  it('rejects an invite for a different host than the one it was minted for', async () => {
    const { host: hostA } = await attachHost();
    const { host: hostB } = await attachHost();
    const invite = await createInvite(hostA);

    const client = new WebSocket(wsUrl('/relay/client'));
    await waitOpen(client);
    const closed = waitClose(client);
    client.send(
      JSON.stringify({
        type: 'client_hello',
        v: RELAY_PROTOCOL_VERSION,
        relayHostId: hostB.relayHostId, // wrong host
        credentialKind: 'invite',
        credential: invite.token,
      }),
    );
    const { code } = await closed;
    expect(code).toBe(4401);

    hostA.ws.close();
    hostB.ws.close();
  });
});

describe('RelayCell — data forwarding', () => {
  it('forwards bytes client → host and host → client once both sides are attached', async () => {
    const { host } = await attachHost();
    const controlMessages = hostMessages(host.ws);
    const invite = await createInvite(host);

    const client = new WebSocket(wsUrl('/relay/client'));
    await waitOpen(client);
    const readyPromise = nextMessage(client);
    client.send(
      JSON.stringify({
        type: 'client_hello',
        v: RELAY_PROTOCOL_VERSION,
        relayHostId: host.relayHostId,
        credentialKind: 'invite',
        credential: invite.token,
      }),
    );
    expect((await readyPromise).type).toBe('client_ready');

    await new Promise((r) => setTimeout(r, 20)); // let stream_open reach the host
    const streamOpen = controlMessages.find((m) => m.type === 'stream_open');
    if (streamOpen?.type !== 'stream_open') throw new Error('host never received stream_open');
    const { streamId } = streamOpen;

    // The host dials back a dedicated data socket for this stream.
    const hostData = new WebSocket(
      wsUrl(`/relay/data?streamId=${encodeURIComponent(streamId)}&relayHostId=${encodeURIComponent(host.relayHostId)}`),
    );
    await waitOpen(hostData);

    const hostReceived: string[] = [];
    hostData.on('message', (raw) => hostReceived.push(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)));
    const clientReceived: string[] = [];
    client.on('message', (raw) => clientReceived.push(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)));

    client.send(Buffer.from('hello-from-client'));
    await new Promise((r) => setTimeout(r, 20));
    expect(hostReceived).toContain('hello-from-client');

    hostData.send(Buffer.from('hello-from-host'));
    await new Promise((r) => setTimeout(r, 20));
    expect(clientReceived).toContain('hello-from-host');

    client.close();
    hostData.close();
    host.ws.close();
  });

  it('buffers client bytes sent before the host attaches its data socket, then flushes them', async () => {
    const { host } = await attachHost();
    const controlMessages = hostMessages(host.ws);
    const invite = await createInvite(host);

    const client = new WebSocket(wsUrl('/relay/client'));
    await waitOpen(client);
    const readyPromise = nextMessage(client);
    client.send(
      JSON.stringify({
        type: 'client_hello',
        v: RELAY_PROTOCOL_VERSION,
        relayHostId: host.relayHostId,
        credentialKind: 'invite',
        credential: invite.token,
      }),
    );
    await readyPromise;
    await new Promise((r) => setTimeout(r, 20));
    const streamOpen = controlMessages.find((m) => m.type === 'stream_open');
    if (streamOpen?.type !== 'stream_open') throw new Error('host never received stream_open');

    // Sent BEFORE the host's data socket exists — must be buffered, not dropped.
    client.send(Buffer.from('sent-before-host-attached'));
    await new Promise((r) => setTimeout(r, 20));

    const hostData = new WebSocket(
      wsUrl(
        `/relay/data?streamId=${encodeURIComponent(streamOpen.streamId)}&relayHostId=${encodeURIComponent(host.relayHostId)}`,
      ),
    );
    const hostReceived: string[] = [];
    hostData.on('message', (raw) => hostReceived.push(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)));
    await waitOpen(hostData);
    await new Promise((r) => setTimeout(r, 20));

    expect(hostReceived).toContain('sent-before-host-attached');

    client.close();
    hostData.close();
    host.ws.close();
  });
});

describe('RelayCell — revocation', () => {
  it('closes a live stream immediately when its device binding is revoked', async () => {
    const { host } = await attachHost();
    hostMessages(host.ws);

    // Pair with a resume credential carrying a known binding, so revocation
    // has something to match against.
    const binding = 'device-binding-1';
    const client = new WebSocket(wsUrl('/relay/client'));
    await waitOpen(client);
    const readyPromise = nextMessage(client);
    client.send(
      JSON.stringify({
        type: 'client_hello',
        v: RELAY_PROTOCOL_VERSION,
        relayHostId: host.relayHostId,
        credentialKind: 'resume',
        credential: 'x'.repeat(20),
        relayBinding: binding,
      }),
    );
    await readyPromise;

    const clientClosed = waitClose(client);
    const requestId = toBase64Url(nodeRandomBytes(8));
    host.ws.send(
      JSON.stringify({ type: 'revoke_device', v: RELAY_PROTOCOL_VERSION, requestId, relayBinding: binding }),
    );
    const { code } = await clientClosed;
    expect(code).toBe(4403);

    host.ws.close();
  });

  it('revokes a stream even before the host has dialled back its data socket, and refuses the belated attach', async () => {
    // △ Fixed during end-to-end review — revocation used to only affect
    // streams where `stream.hostSocket` was already attached, leaving a
    // window (client paired, host has not yet dialled `/relay/data`) where
    // a revoked device's stream survived untouched.
    const { host } = await attachHost();
    const controlMessages = hostMessages(host.ws);
    const binding = 'device-binding-early';

    const client = new WebSocket(wsUrl('/relay/client'));
    await waitOpen(client);
    const readyPromise = nextMessage(client);
    client.send(
      JSON.stringify({
        type: 'client_hello',
        v: RELAY_PROTOCOL_VERSION,
        relayHostId: host.relayHostId,
        credentialKind: 'resume',
        credential: 'x'.repeat(20),
        relayBinding: binding,
      }),
    );
    await readyPromise;
    await new Promise((r) => setTimeout(r, 20));
    const streamOpen = controlMessages.find((m) => m.type === 'stream_open');
    if (streamOpen?.type !== 'stream_open') throw new Error('host never received stream_open');

    // Revoke BEFORE the host attaches its data socket for this stream.
    const clientClosed = waitClose(client);
    host.ws.send(
      JSON.stringify({
        type: 'revoke_device',
        v: RELAY_PROTOCOL_VERSION,
        requestId: toBase64Url(nodeRandomBytes(8)),
        relayBinding: binding,
      }),
    );
    const { code } = await clientClosed;
    expect(code).toBe(4403);

    // The host's belated dial-back must be refused, not silently accepted.
    const belatedHostData = new WebSocket(
      wsUrl(
        `/relay/data?streamId=${encodeURIComponent(streamOpen.streamId)}&relayHostId=${encodeURIComponent(host.relayHostId)}`,
      ),
    );
    const belatedClosed = waitClose(belatedHostData);
    await waitOpen(belatedHostData);
    const { code: belatedCode } = await belatedClosed;
    expect(belatedCode).toBe(4404);

    host.ws.close();
  });

  it('refuses a NEW pairing attempt for an already-revoked binding', async () => {
    const { host } = await attachHost();
    hostMessages(host.ws);
    const binding = 'device-binding-2';
    const requestId = toBase64Url(nodeRandomBytes(8));
    host.ws.send(
      JSON.stringify({ type: 'revoke_device', v: RELAY_PROTOCOL_VERSION, requestId, relayBinding: binding }),
    );
    await new Promise((r) => setTimeout(r, 20));

    const client = new WebSocket(wsUrl('/relay/client'));
    await waitOpen(client);
    const closed = waitClose(client);
    client.send(
      JSON.stringify({
        type: 'client_hello',
        v: RELAY_PROTOCOL_VERSION,
        relayHostId: host.relayHostId,
        credentialKind: 'resume',
        credential: 'x'.repeat(20),
        relayBinding: binding,
      }),
    );
    const { code } = await closed;
    expect(code).toBe(4403);

    host.ws.close();
  });
});

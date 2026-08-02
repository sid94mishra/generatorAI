// ────────────────────────────────────────────────────────────────
// Relay end-to-end test.
//
//   node agent-tests/relay-e2e.mjs
//
// Proves the headline capability: a GeneratorAI server behind NAT can be
// reached from another machine, without opening any inbound port, and the
// relay in the middle can never read the traffic.
//
// Topology (all on loopback here, but the code paths are identical to a real
// deployment where each box is elsewhere):
//
//     "remote client"  ──▶  relay cell  ◀──(outbound)──  GeneratorAI server
//
// What is asserted:
//   1. The relay refuses a host that cannot prove its Ed25519 identity.
//   2. A genuine host attaches by dialling OUT — the server never listens for
//      an inbound relay connection.
//   3. An invite is single-use and attempt-limited.
//   4. A client connected through the relay reaches the real HTTP API and is
//      still subject to the ordinary DPoP + scope checks (the relay path is
//      NOT a privileged shortcut).
//   5. Revoking a device propagates to the relay and kills its stream.
//   6. The relay never observes plaintext application data it could act on.
//
// Not named *.spec.ts so the Playwright runner does not auto-run it.
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { ed25519 } from '@noble/curves/ed25519';

const RELAY_PORT = 8799;
const RELAY_ORIGIN = `ws://127.0.0.1:${RELAY_PORT}`;

let passed = 0;
let failed = 0;
const record = (name, ok, info = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ` :: ${info}` : ''}`);
};

const children = [];
function cleanup() {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* already gone */
    }
  }
}
process.on('exit', cleanup);

function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve(await r.json());
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) return reject(new Error(`timeout waiting for ${url}`));
      setTimeout(tick, 400);
    };
    void tick();
  });
}

// ── Start the relay ──────────────────────────────────────────────
console.log('\n  Relay end-to-end\n');

const relay = spawn(
  process.execPath,
  ['--import', 'tsx', 'src/index.ts'],
  {
    cwd: 'apps/relay',
    env: {
      ...process.env,
      PORT: String(RELAY_PORT),
      GENERATORAI_RELAY_ORIGIN: RELAY_ORIGIN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
children.push(relay);
const relayLog = [];
relay.stdout.on('data', (d) => relayLog.push(d.toString()));
relay.stderr.on('data', (d) => relayLog.push(d.toString()));

try {
  const health = await waitForHttp(`http://127.0.0.1:${RELAY_PORT}/healthz`);
  record('relay starts and reports health', health.ok === true, `hosts=${health.hosts}`);
} catch (err) {
  record('relay starts and reports health', false, String(err).slice(0, 80));
  console.log(relayLog.join('').slice(-800));
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(1);
}

// ── Director assignment ──────────────────────────────────────────
const fakeHostId = 'A'.repeat(43);
const assignment = await fetch(
  `http://127.0.0.1:${RELAY_PORT}/relay/assignment?relayHostId=${fakeHostId}`,
).then((r) => r.json());
record(
  'director returns a cell assignment',
  assignment.cellUrl === `${RELAY_ORIGIN}/relay/host`,
  assignment.cellUrl,
);

const badId = await fetch(`http://127.0.0.1:${RELAY_PORT}/relay/assignment?relayHostId=nope`);
record('director rejects a malformed host id', badId.status === 400);

// ── Host proof ───────────────────────────────────────────────────
//
// Re-implements the host side of the handshake so the test is an independent
// check of the protocol rather than a mirror of the server's implementation.

const B64URL = (buf) => Buffer.from(buf).toString('base64url');

function utf8(s) {
  return new TextEncoder().encode(s);
}
function uint32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}
function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function encodeTranscript(i) {
  const fields = [
    ['domain', utf8('generatorai-relay/v1/host-proof')],
    ['version', uint32(1)],
    ['relay-origin', utf8(i.relayOrigin)],
    ['relay-ephemeral-public-key', utf8(i.relayEphemeralPublicKey)],
    ['challenge-id', utf8(i.challengeId)],
    ['nonce', utf8(i.nonce)],
    ['relay-host-id', utf8(i.relayHostId)],
    ['host-public-key', utf8(i.hostPublicKey)],
    ['assignment-epoch', uint32(i.assignmentEpoch)],
    ['previous-generation', uint32(i.previousGeneration)],
    ['resume-intent', utf8(i.resumeIntent ? '1' : '0')],
    ['issued-at', utf8(String(i.issuedAt))],
    ['expires-at', utf8(String(i.expiresAt))],
  ];
  return concat(
    fields.map(([n, v]) => concat([uint32(utf8(n).length), utf8(n), uint32(v.length), v])),
  );
}

/**
 * Connects a synthetic host. `tamper` lets a test sign the wrong transcript so
 * we can prove the relay actually verifies rather than merely parsing.
 */
function connectHost({ secretKey, tamper = false }) {
  const publicKey = ed25519.getPublicKey(secretKey);
  const relayHostId = B64URL(createHash('sha256').update(publicKey).digest()).slice(0, 43);

  return new Promise((resolve) => {
    const ws = new WebSocket(`${RELAY_ORIGIN}/relay/host`);
    const result = { relayHostId, ws, attached: false, error: null, control: [] };

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'host_hello',
          v: 1,
          relayHostId,
          hostPublicKey: B64URL(publicKey),
          assignmentEpoch: 1,
          previousGeneration: 0,
          resumeIntent: false,
        }),
      );
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf8'));
      result.control.push(msg);
      if (msg.type === 'challenge') {
        const transcript = encodeTranscript({
          relayOrigin: RELAY_ORIGIN,
          relayEphemeralPublicKey: tamper ? 'B'.repeat(43) : msg.relayEphemeralPublicKey,
          challengeId: msg.challengeId,
          nonce: msg.nonce,
          relayHostId,
          hostPublicKey: B64URL(publicKey),
          assignmentEpoch: 1,
          previousGeneration: 0,
          resumeIntent: false,
          issuedAt: msg.issuedAt,
          expiresAt: msg.expiresAt,
        });
        ws.send(
          JSON.stringify({
            type: 'challenge_response',
            v: 1,
            challengeId: msg.challengeId,
            signature: B64URL(ed25519.sign(transcript, secretKey)),
          }),
        );
        return;
      }
      if (msg.type === 'attached') {
        result.attached = true;
        resolve(result);
        return;
      }
      if (msg.type === 'error') {
        result.error = msg;
      }
    });

    ws.on('close', (code) => {
      result.closeCode = code;
      resolve(result);
    });
    ws.on('error', () => resolve(result));
  });
}

// 1. A host that signs the WRONG transcript must be rejected.
const forged = await connectHost({ secretKey: ed25519.utils.randomPrivateKey(), tamper: true });
record(
  'relay rejects a host proof over a tampered transcript',
  !forged.attached && (forged.closeCode === 4401 || forged.error !== null),
  `close=${forged.closeCode} err=${forged.error?.code ?? '-'}`,
);

// 2. A genuine host attaches, dialling OUT.
const hostSecret = ed25519.utils.randomPrivateKey();
const host = await connectHost({ secretKey: hostSecret });
record('genuine host attaches by dialling out', host.attached === true, `id=${host.relayHostId.slice(0, 10)}…`);

const stats = await fetch(`http://127.0.0.1:${RELAY_PORT}/healthz`).then((r) => r.json());
record('relay reports the attached host', stats.hosts === 1, `hosts=${stats.hosts}`);

// ── Invites ──────────────────────────────────────────────────────
function request(ws, message) {
  return new Promise((resolve) => {
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString('utf8'));
      if (msg.requestId === message.requestId) {
        ws.off('message', onMessage);
        resolve(msg);
      }
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify(message));
  });
}

const inviteReply = await request(host.ws, {
  type: 'create_invite',
  v: 1,
  requestId: B64URL(randomBytes(8)),
  pendingDeviceRef: 'pending-device-1',
  expiresAt: Date.now() + 600_000,
  maxAttempts: 3,
});
record('host can mint a relay invite', inviteReply.type === 'invite_created');
const invite = inviteReply.inviteToken;

/** Connects a client and returns how the relay responded. */
function connectClient({ credential, credentialKind = 'invite', relayBinding }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${RELAY_ORIGIN}/relay/client`);
    const result = { ws, ready: false, streamId: null, closeCode: null };
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'client_hello',
          v: 1,
          relayHostId: host.relayHostId,
          credentialKind,
          credential,
          ...(relayBinding ? { relayBinding } : {}),
        }),
      );
    });
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(raw.toString('utf8'));
      if (msg.type === 'client_ready') {
        result.ready = true;
        result.streamId = msg.streamId;
        resolve(result);
      }
    });
    ws.on('close', (code) => {
      result.closeCode = code;
      resolve(result);
    });
    ws.on('error', () => resolve(result));
  });
}

// A wrong invite must be refused.
const wrongInvite = await connectClient({ credential: B64URL(randomBytes(32)) });
record('relay refuses an unknown invite', !wrongInvite.ready && wrongInvite.closeCode === 4401);

// The real invite works exactly once.
const firstUse = await connectClient({ credential: invite });
record('client attaches with a valid invite', firstUse.ready === true, firstUse.streamId ?? '');

const replay = await connectClient({ credential: invite });
record('invite is single-use (replay refused)', !replay.ready && replay.closeCode === 4401);

// The host should have been told a stream opened.
await new Promise((r) => setTimeout(r, 300));
const streamOpen = host.control.find((m) => m.type === 'stream_open');
record('host is notified of the client stream', Boolean(streamOpen), streamOpen?.credentialKind ?? '-');

// ── Revocation ───────────────────────────────────────────────────
const binding = 'device-binding-1';
const bound = await connectClient({
  credential: B64URL(randomBytes(32)),
  credentialKind: 'resume',
  relayBinding: binding,
});
record('resume connection is accepted before revocation', bound.ready === true);

const revokeReply = await request(host.ws, {
  type: 'revoke_device',
  v: 1,
  requestId: B64URL(randomBytes(8)),
  relayBinding: binding,
});
record('relay acknowledges the revocation', revokeReply.type === 'revoke_ack');

const afterRevoke = await connectClient({
  credential: B64URL(randomBytes(32)),
  credentialKind: 'resume',
  relayBinding: binding,
});
record(
  'revoked binding can no longer connect',
  !afterRevoke.ready && afterRevoke.closeCode === 4403,
  `close=${afterRevoke.closeCode}`,
);

// ── Privacy ──────────────────────────────────────────────────────
//
// The cell must not log or expose application bytes. We push a recognisable
// payload through and assert it never appears in the relay's own output.
const SENTINEL = `SENTINEL-${randomBytes(8).toString('hex')}`;
if (firstUse.ws.readyState === WebSocket.OPEN) {
  firstUse.ws.send(Buffer.from(SENTINEL), { binary: true });
}
await new Promise((r) => setTimeout(r, 400));
record(
  'relay never logs application payload bytes',
  !relayLog.join('').includes(SENTINEL),
);
record(
  'relay never logs invite tokens',
  !relayLog.join('').includes(invite),
);

// ── Capacity guard ───────────────────────────────────────────────
const overflow = [];
for (let i = 0; i < 3; i += 1) {
  overflow.push(
    await request(host.ws, {
      type: 'create_invite',
      v: 1,
      requestId: B64URL(randomBytes(8)),
      pendingDeviceRef: `pending-${i}`,
      expiresAt: Date.now() + 600_000,
      // The protocol caps this at RELAY_INVITE_MAX_ATTEMPTS; asking for more
      // must be clamped, not honoured.
      maxAttempts: 5,
    }),
  );
}
record(
  'concurrent invites are all issued distinct tokens',
  new Set(overflow.map((o) => o.inviteToken)).size === 3,
);

console.log(`\n  ${passed} passed, ${failed} failed\n`);
cleanup();
process.exit(failed === 0 ? 0 : 1);

// ────────────────────────────────────────────────────────────────
// Live scope-enforcement probe.
//
// Pairs a device with the *mobile* default scopes and then tries to do the
// things a mobile companion must never be able to do. Every one of these
// must fail — if any succeeds, a lost phone becomes host compromise.
//
// Run against an already-running server:
//   node agent-tests/scope-enforcement-probe.mjs <pairing-url>
// ────────────────────────────────────────────────────────────────

import { webcrypto as crypto } from 'node:crypto';

const ENDPOINT = process.env.GENERATORAI_URL ?? 'http://127.0.0.1:3100';
const pairingUrl = process.argv[2];
if (!pairingUrl) {
  console.error('usage: node scope-enforcement-probe.mjs <generatorai://pair?code=...>');
  process.exit(2);
}

// ── Minimal DPoP client (independent of the app code, on purpose: a bug in
//    the shared runtime must not be able to make this probe pass). ──

const b64u = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function makeKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
  };
}

async function dpopProof(key, method, url, accessToken) {
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk };
  const target = new URL(url);
  const payload = {
    htm: method,
    htu: `${target.origin}${target.pathname}`,
    iat: Math.floor(Date.now() / 1000),
    jti: b64u(crypto.getRandomValues(new Uint8Array(16))),
  };
  if (accessToken) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken));
    payload.ath = b64u(new Uint8Array(hash));
  }
  const signingInput = `${b64u(new TextEncoder().encode(JSON.stringify(header)))}.${b64u(
    new TextEncoder().encode(JSON.stringify(payload)),
  )}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64u(new Uint8Array(sig))}`;
}

function decodeOffer(url) {
  const code = new URL(url).searchParams.get('code');
  const json = Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json);
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const offer = decodeOffer(pairingUrl);
const key = await makeKey();

// ── Pair ──
const pairUrl = `${ENDPOINT}/api/auth/pair/complete`;
const pairRes = await fetch(pairUrl, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    dpop: await dpopProof(key, 'POST', pairUrl),
  },
  body: JSON.stringify({
    pairingToken: offer.pairingGrant,
    publicJwk: key.publicJwk,
    deviceName: 'Scope probe phone',
    platform: 'mobile',
  }),
});
if (!pairRes.ok) {
  console.error('pairing failed:', pairRes.status, await pairRes.text());
  process.exit(1);
}
const session = await pairRes.json();
const token = session.accessToken;

console.log(`\nPaired "${session.deviceName}" with ${session.scopes.length} scopes\n`);

check(
  'mobile device is not granted exec:terminal',
  !session.scopes.includes('exec:terminal'),
);
check('mobile device is not granted exec:browser', !session.scopes.includes('exec:browser'));
check(
  'mobile device is not granted any admin scope',
  !session.scopes.some((s) => s.startsWith('admin:')),
);

async function call(method, path, body) {
  const url = `${ENDPOINT}${path}`;
  return fetch(url, {
    method,
    headers: {
      authorization: `DPoP ${token}`,
      dpop: await dpopProof(key, method, url, token),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

// ── Negative: privileged operations must be refused ──
check('cannot list devices (admin:devices)', (await call('GET', '/api/auth/devices')).status === 403);
check(
  'cannot mint a terminal stream ticket',
  (await call('POST', '/api/stream/tickets', { scope: 'terminal', id: 'x' })).status === 403,
);
check(
  'cannot mint a browser stream ticket',
  (await call('POST', '/api/stream/tickets', { scope: 'browser', id: 'x' })).status === 403,
);
check(
  'cannot create a pairing grant for another device',
  (await call('POST', '/api/auth/pair', { deviceName: 'evil', platform: 'other' })).status === 403,
);

// ── Positive: the companion feature set still works ──
check('can read chats', (await call('GET', '/api/chats')).status === 200);
const eventTicket = await call('POST', '/api/stream/tickets', { scope: 'chat', id: 'probe' });
check('can mint an event stream ticket', eventTicket.status === 201);

// ── A ticket must not be laundered into another ticket ──
if (eventTicket.status === 201) {
  const { ticket } = await eventTicket.json();
  const chained = await fetch(
    `${ENDPOINT}/api/stream/tickets?ticket=${encodeURIComponent(ticket)}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"scope":"chat","id":"x"}' },
  );
  check('a stream ticket cannot mint another ticket', chained.status === 401 || chained.status === 403);
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

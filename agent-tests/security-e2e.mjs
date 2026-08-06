// ────────────────────────────────────────────────────────────────
// End-to-end smoke test for the security / pairing / DPoP stack.
//
// Boots the real server in a temp data dir and drives the full lifecycle:
//   1. fail-closed: no credential ⇒ 401
//   2. admin bootstrap via the legacy service-account key
//   3. create pairing grant ⇒ decode the offer ⇒ complete pairing with DPoP
//   4. authenticated request with a DPoP-bound token
//   5. scope enforcement (a default device must NOT get exec:terminal)
//   6. stream ticket mint + single-use redemption
//   7. DPoP replay rejection
//   8. device revocation ⇒ immediate 401
//
// Run: node agent-tests/security-e2e.mjs
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.SMOKE_PORT ?? 3199);
const BASE = `http://127.0.0.1:${PORT}`;
const API_KEY = 'smoke-test-admin-key-0123456789abcdef';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── Minimal client-side DPoP implementation (mirrors client-runtime) ──

const b64u = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jsonB64u = (v) => b64u(new TextEncoder().encode(JSON.stringify(v)));

async function makeDeviceKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  return {
    publicJwk,
    async sign(data) {
      return new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, data),
      );
    },
  };
}

async function sha256b64u(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return b64u(new Uint8Array(digest));
}

async function dpopProof(key, method, url, { accessToken, nonce, jti } = {}) {
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk };
  const parsed = new URL(url);
  parsed.search = '';
  parsed.hash = '';
  const payload = {
    jti: jti ?? b64u(crypto.getRandomValues(new Uint8Array(16))),
    htm: method.toUpperCase(),
    htu: parsed.toString(),
    iat: Math.floor(Date.now() / 1000),
  };
  if (accessToken) payload.ath = await sha256b64u(accessToken);
  if (nonce) payload.nonce = nonce;
  const input = `${jsonB64u(header)}.${jsonB64u(payload)}`;
  const sig = await key.sign(new TextEncoder().encode(input));
  return `${input}.${b64u(sig)}`;
}

// ── Server lifecycle ──────────────────────────────────────────────

async function waitForHealth(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function startServer(dataDir, extraEnv = {}) {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join(ROOT, 'apps', 'server', 'src', 'index.ts')],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PORT: String(PORT),
        WIDGET_PORT: String(PORT + 1),
        DB_PATH: join(dataDir, 'smoke.db'),
        WORKSPACES_DIR: join(dataDir, 'workspaces'),
        ARTIFACTS_DIR: join(dataDir, 'artifacts'),
        GENERATORAI_EXTENSIONS_DIR: join(dataDir, 'extensions'),
        GENERATORAI_SECRETS_DIR: dataDir,
        // Deterministic KEK so the vault is "secure" without an OS keychain.
        GENERATORAI_SECRET_KEY: Buffer.alloc(32, 7).toString('base64'),
        GENERATORAI_BIND_HOST: '127.0.0.1',
        GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK: '0',
        LOG_LEVEL: 'warn',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  return { child, logs };
}

async function stopServer(handle) {
  if (!handle?.child || handle.child.killed) return;
  handle.child.kill('SIGTERM');
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      try {
        handle.child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, 10_000);
    handle.child.on('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

// ── Scenarios ─────────────────────────────────────────────────────

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), 'genai-sec-'));
  let server;

  try {
    console.log('\n=== 1. Fail-closed startup guard ===');
    {
      // Unauthenticated mode on a NON-loopback bind must refuse to start.
      const bad = startServer(dataDir, {
        GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK: '1',
        GENERATORAI_BIND_HOST: '0.0.0.0',
        PORT: String(PORT + 10),
      });
      const code = await new Promise((resolve) => {
        const t = setTimeout(() => resolve('timeout'), 60_000);
        bad.child.on('exit', (c) => {
          clearTimeout(t);
          resolve(c);
        });
      });
      await stopServer(bad);
      check(
        'refuses to start unauthenticated on a non-loopback bind',
        code === 2,
        `exit=${code}; logs=${bad.logs.join('').slice(-400)}`,
      );
    }

    console.log('\n=== 2. Boot with admin service account ===');
    server = startServer(dataDir, { GENERATORAI_API_KEY: API_KEY });
    const healthy = await waitForHealth();
    check('server became healthy', healthy, server.logs.join('').slice(-800));
    if (!healthy) return;

    console.log('\n=== 3. Unauthenticated access is rejected ===');
    {
      const res = await fetch(`${BASE}/api/projects`);
      check('GET /api/projects without credential ⇒ 401', res.status === 401, `got ${res.status}`);
      const wwwAuth = res.headers.get('www-authenticate');
      check('401 advertises DPoP', (wwwAuth ?? '').includes('DPoP'), `got ${wwwAuth}`);
    }
    {
      const res = await fetch(`${BASE}/api/health`);
      check('GET /api/health stays public', res.ok, `got ${res.status}`);
    }

    console.log('\n=== 4. Server info + pairing grant ===');
    const serverInfo = await (await fetch(`${BASE}/api/auth/server-info`)).json();
    check('server-info exposes a host id', typeof serverInfo.serverId === 'string');
    check('server-info never leaks a private key', !JSON.stringify(serverInfo).includes('"d"'));

    const pairRes = await fetch(`${BASE}/api/auth/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ deviceName: 'Smoke Test Device', platform: 'cli' }),
    });
    const pairBody = await pairRes.json();
    check('pairing grant created', pairRes.status === 201, JSON.stringify(pairBody).slice(0, 300));
    if (pairRes.status !== 201) return;
    check('pairing code is returned', typeof pairBody.pairingCode === 'string');
    check('pairing grant expires within 10 min', pairBody.expiresAt - Date.now() <= 10 * 60_000);

    // Decode the offer exactly as a client would.
    const offer = JSON.parse(Buffer.from(pairBody.pairingCode, 'base64url').toString('utf8'));
    check('offer serverId matches server-info', offer.serverId === serverInfo.serverId);
    check('offer carries the pairing grant', typeof offer.pairingGrant === 'string');

    console.log('\n=== 5. Complete pairing with DPoP ===');
    const key = await makeDeviceKey();
    const pairUrl = `${BASE}/api/auth/pair/complete`;

    // Without a proof it must be refused, even with a valid grant.
    {
      const res = await fetch(pairUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairingToken: offer.pairingGrant, publicJwk: key.publicJwk }),
      });
      check('pairing without a DPoP proof ⇒ 401', res.status === 401, `got ${res.status}`);
    }

    const completeRes = await fetch(pairUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        dpop: await dpopProof(key, 'POST', pairUrl),
      },
      body: JSON.stringify({
        pairingToken: offer.pairingGrant,
        publicJwk: key.publicJwk,
        deviceName: 'Smoke Test Device',
        platform: 'cli',
      }),
    });
    const session = await completeRes.json();
    check('pairing completed', completeRes.status === 201, JSON.stringify(session).slice(0, 300));
    if (completeRes.status !== 201) return;
    check('access token issued', typeof session.accessToken === 'string');
    check('resume secret issued', typeof session.resumeSecret === 'string');
    check(
      'CLI device gets exec:terminal by default',
      session.scopes.includes('exec:terminal'),
      JSON.stringify(session.scopes),
    );
    check(
      'CLI device does NOT get admin:devices by default',
      !session.scopes.includes('admin:devices'),
    );

    console.log('\n=== 6. Pairing grant is single-use ===');
    {
      const key2 = await makeDeviceKey();
      const res = await fetch(pairUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          dpop: await dpopProof(key2, 'POST', pairUrl),
        },
        body: JSON.stringify({ pairingToken: offer.pairingGrant, publicJwk: key2.publicJwk }),
      });
      check('reusing a consumed pairing grant fails', res.status >= 400, `got ${res.status}`);
    }

    console.log('\n=== 7. Authenticated requests ===');
    const authedFetch = async (path, init = {}) => {
      const url = `${BASE}${path}`;
      return fetch(url, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          authorization: `DPoP ${session.accessToken}`,
          dpop: await dpopProof(key, init.method ?? 'GET', url, {
            accessToken: session.accessToken,
          }),
        },
      });
    };
    {
      const res = await authedFetch('/api/projects');
      check('DPoP-authenticated GET /api/projects succeeds', res.ok, `got ${res.status}`);
    }
    {
      // The token alone, presented as a plain bearer, must be refused.
      const res = await fetch(`${BASE}/api/projects`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      check(
        'DPoP-bound token rejected when presented as Bearer',
        res.status === 401,
        `got ${res.status}`,
      );
    }
    {
      // Proof for a different method must not be accepted.
      const url = `${BASE}/api/projects`;
      const res = await fetch(url, {
        headers: {
          authorization: `DPoP ${session.accessToken}`,
          dpop: await dpopProof(key, 'DELETE', url, { accessToken: session.accessToken }),
        },
      });
      check('DPoP proof with a mismatched htm is rejected', res.status === 401, `got ${res.status}`);
    }
    {
      // Replay: the same jti twice must be refused.
      const url = `${BASE}/api/projects`;
      const jti = b64u(crypto.getRandomValues(new Uint8Array(16)));
      const proof = await dpopProof(key, 'GET', url, { accessToken: session.accessToken, jti });
      const first = await fetch(url, {
        headers: { authorization: `DPoP ${session.accessToken}`, dpop: proof },
      });
      const second = await fetch(url, {
        headers: { authorization: `DPoP ${session.accessToken}`, dpop: proof },
      });
      check('first use of a proof succeeds', first.ok, `got ${first.status}`);
      check('replayed DPoP proof is rejected', second.status === 401, `got ${second.status}`);
    }

    console.log('\n=== 8. Scope enforcement ===');
    {
      const res = await authedFetch('/api/auth/devices');
      check(
        'device without admin:devices cannot list devices',
        res.status === 403,
        `got ${res.status}`,
      );
      const body = await res.json().catch(() => ({}));
      check(
        '403 explains the missing scope',
        JSON.stringify(body).includes('admin:devices'),
        JSON.stringify(body).slice(0, 200),
      );
    }

    console.log('\n=== 9. Stream tickets ===');
    let ticket;
    {
      const res = await authedFetch('/api/stream/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'global', id: null }),
      });
      const body = await res.json();
      ticket = body.ticket;
      check('stream ticket minted', res.status === 201, JSON.stringify(body).slice(0, 200));
      check('ticket expires within 60s', body.expiresAt - Date.now() <= 60_000);
      check('response is not cacheable', res.headers.get('cache-control') === 'no-store');
    }
    if (ticket) {
      const url = `${BASE}/api/stream?scope=global&ticket=${encodeURIComponent(ticket)}`;
      const controller = new AbortController();
      const res = await fetch(url, { signal: controller.signal });
      check('SSE accepts a valid ticket', res.ok, `got ${res.status}`);
      controller.abort();
      // Single-use: the second redemption must fail.
      const again = await fetch(
        `${BASE}/api/stream?scope=global&ticket=${encodeURIComponent(ticket)}`,
      );
      check('ticket cannot be redeemed twice', again.status === 401, `got ${again.status}`);
    }
    {
      // A ticket minted for one subscription must not open another.
      const res = await authedFetch('/api/stream/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'chat', id: 'chat-a' }),
      });
      const { ticket: scoped } = await res.json();
      const wrong = await fetch(
        `${BASE}/api/stream?scope=chat&id=chat-b&ticket=${encodeURIComponent(scoped)}`,
      );
      check('ticket pinned to its subscription', wrong.status >= 400, `got ${wrong.status}`);
    }

    console.log('\n=== 10. Token refresh rotates the resume credential ===');
    let refreshed;
    {
      const url = `${BASE}/api/auth/token/refresh`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', dpop: await dpopProof(key, 'POST', url) },
        body: JSON.stringify({ resumeSecret: session.resumeSecret }),
      });
      refreshed = await res.json();
      check('refresh succeeds', res.ok, JSON.stringify(refreshed).slice(0, 200));
      check(
        'resume credential rotated',
        refreshed.resumeSecret && refreshed.resumeSecret !== session.resumeSecret,
      );
    }
    {
      // A refresh proof signed by a DIFFERENT key must be refused.
      const other = await makeDeviceKey();
      const url = `${BASE}/api/auth/token/refresh`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', dpop: await dpopProof(other, 'POST', url) },
        body: JSON.stringify({ resumeSecret: refreshed.resumeSecret }),
      });
      check('refresh with the wrong device key is rejected', res.status >= 400, `got ${res.status}`);
    }

    console.log('\n=== 11. Security posture ===');
    {
      const res = await fetch(`${BASE}/api/security/posture`, {
        headers: { authorization: `Bearer ${API_KEY}` },
      });
      const body = await res.json();
      check('posture endpoint responds', res.ok, `got ${res.status}`);
      check('reports authentication as required', body.authentication?.required === true);
      check('reports a secure secret backend', body.secretStore?.secure === true, body.secretStore?.kind);
      check(
        'warns about the legacy API key',
        (body.warnings ?? []).some((w) => w.code === 'LEGACY_API_KEY'),
      );
    }

    console.log('\n=== 12. Device revocation ===');
    {
      const list = await (
        await fetch(`${BASE}/api/auth/devices`, {
          headers: { authorization: `Bearer ${API_KEY}` },
        })
      ).json();
      const device = list.devices.find((d) => d.deviceId === session.deviceId);
      check('paired device appears in the device list', Boolean(device));
      check('device list never leaks key material', !JSON.stringify(list).includes('publicJwk'));

      const res = await fetch(`${BASE}/api/auth/devices/${session.deviceId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ reason: 'smoke test' }),
      });
      check('device revoked', res.status === 204, `got ${res.status}`);

      const after = await fetch(`${BASE}/api/projects`, {
        headers: {
          authorization: `DPoP ${refreshed.accessToken}`,
          dpop: await dpopProof(key, 'GET', `${BASE}/api/projects`, {
            accessToken: refreshed.accessToken,
          }),
        },
      });
      check('revoked device is rejected immediately', after.status === 401, `got ${after.status}`);
    }

    console.log('\n=== 13. Audit trail ===');
    {
      const res = await fetch(`${BASE}/api/auth/audit?limit=200`, {
        headers: { authorization: `Bearer ${API_KEY}` },
      });
      const body = await res.json();
      const actions = new Set((body.events ?? []).map((e) => e.action));
      check('audit records pairing', actions.has('pairing.consumed') || actions.has('device.created'));
      check('audit records revocation', actions.has('device.revoked'));
      check('audit records denials', actions.has('auth.denied') || actions.has('auth.failure'));
      const raw = JSON.stringify(body);
      check('audit never contains the API key', !raw.includes(API_KEY));
      check('audit never contains a resume secret', !raw.includes(session.resumeSecret));
    }

    console.log('\n=== 14. Log redaction ===');
    {
      const logText = server.logs.join('');
      check('server logs never contain the API key', !logText.includes(API_KEY));
      check('server logs never contain the resume secret', !logText.includes(session.resumeSecret));
      check('server logs never contain a stream ticket', !ticket || !logText.includes(ticket));
    }
  } finally {
    await stopServer(server);
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  • ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});

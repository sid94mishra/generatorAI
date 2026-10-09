// Real LAN multi-device pairing probe.
// Run: node --import tsx agent-tests/lan-pairing-e2e.mjs
//
// Once Network exposure is on (D-110, D-111, D-127) every other device talks
// HTTPS: the native app pairs over https:// with the local CA from the offer
// pinned (MV-44) — its DPoP proofs are bound to https:// URLs — and so does a
// browser-class client. Plain HTTP from the LAN is refused for everyone; this
// machine (loopback) keeps plain HTTP.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { X509Certificate } from 'node:crypto';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_KEY = 'lan-e2e-admin-key-0123456789abcdef';
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${!condition && detail ? ` :: ${detail}` : ''}`);
  if (condition) passed += 1;
  else failed += 1;
}

function privateIpv4() {
  const candidates = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.internal || address.family !== 'IPv4') continue;
      if (!/^(10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.address)) continue;
      candidates.push({ name, address: address.address });
    }
  }
  return (
    candidates.find(({ name }) => !/virtual|vethernet|wsl|docker|default switch/i.test(name)) ??
    candidates[0] ??
    null
  );
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitFor(url, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}

const lan = privateIpv4();
if (!lan) {
  console.error('No private IPv4 interface is available for the LAN pairing E2E test.');
  process.exit(1);
}

const port = await freePort();
const widgetPort = await freePort();
const liveOrigin = `https://${lan.address}:${port}`;
const plainLanOrigin = `http://${lan.address}:${port}`;
const loopbackOrigin = `http://127.0.0.1:${port}`;
const deadOrigin = `https://10.255.255.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'generatorai-lan-'));
const logs = [];
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    WIDGET_PORT: String(widgetPort),
    DB_PATH: join(dataDir, 'lan.db'),
    WORKSPACES_DIR: join(dataDir, 'workspaces'),
    ARTIFACTS_DIR: join(dataDir, 'artifacts'),
    GENERATORAI_EXTENSIONS_DIR: join(dataDir, 'extensions'),
    GENERATORAI_SECRETS_DIR: dataDir,
    GENERATORAI_SECRET_KEY: randomBytes(32).toString('base64'),
    GENERATORAI_BIND_HOST: '0.0.0.0',
    GENERATORAI_ADVERTISED_URLS: `${deadOrigin},${liveOrigin}`,
    GENERATORAI_API_KEY: API_KEY,
    GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK: '0',
    LOG_LEVEL: 'warn',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (data) => logs.push(String(data)));
child.stderr.on('data', (data) => logs.push(String(data)));

try {
  console.log(`\n  LAN pairing via ${lan.name} (${lan.address})\n`);
  const healthy = await waitFor(`${loopbackOrigin}/api/health`, child);
  check('server is up (loopback)', healthy, logs.join('').slice(-500));
  if (!healthy) throw new Error('LAN server did not start');

  // The local CA, read from this machine (plain HTTP is loopback-only now).
  const caPem = await fetch(`${loopbackOrigin}/api/auth/tls/ca.crt`).then((response) => response.text());
  check('the local CA certificate is served (public)', caPem.includes('BEGIN CERTIFICATE'));
  const caFingerprint = new X509Certificate(caPem).fingerprint256;
  const { Agent, WebSocket: UndiciWebSocket, fetch: undiciFetch } = await import('undici');
  // What the app's native trust module does: trust exactly this CA for the LAN address.
  const pinnedCa = new Agent({ connect: { ca: caPem } });
  const httpsFetch = (url, init) => undiciFetch(url, { ...init, dispatcher: pinnedCa });

  const info = await httpsFetch(`${liveOrigin}/api/auth/server-info`).then((response) => response.json());
  check('server-info publishes protocol version 2', info.protocolVersion === 2);
  check(
    'server-info includes the live LAN endpoint',
    info.endpoints?.some((endpoint) => endpoint.origin === liveOrigin),
  );
  check('server-info does not claim relay client support', info.transports?.relay === false);

  const pairResponse = await fetch(`${loopbackOrigin}/api/auth/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ deviceName: 'LAN E2E Phone', platform: 'mobile' }),
  });
  const pairBody = await pairResponse.json();
  check('mobile pairing offer is created', pairResponse.status === 201, JSON.stringify(pairBody));
  if (pairResponse.status !== 201) throw new Error('Pairing offer was not created');

  const {
    AuthenticatedClientRuntime,
    MemoryDeviceKeyStore,
    MemorySessionStore,
    parsePairingCode,
  } = await import('../packages/client-runtime/src/index.ts');
  const consent = parsePairingCode(pairBody.pairingCode);
  check('offer uses the configured dead endpoint first', consent.endpoint === deadOrigin);
  check(
    'offer retains the live LAN fallback',
    consent.endpoints.some((endpoint) => endpoint.origin === liveOrigin),
  );
  check(
    'a mobile offer lists only https:// network addresses (no plain-HTTP lane)',
    consent.endpoints.every((endpoint) => endpoint.origin.startsWith('https://') || endpoint.origin.startsWith('http://127.0.0.1')),
    JSON.stringify(consent.endpoints),
  );
  check(
    'the mobile offer carries the CA fingerprint for pinning (base64url)',
    consent.offer.certificateFingerprint ===
      Buffer.from(caFingerprint.replace(/:/g, ''), 'hex').toString('base64url'),
  );
  check(
    'the mobile offer carries a different standby CA fingerprint (D-127)',
    /^[A-Za-z0-9_-]{43}$/.test(consent.offer.backupCertificateFingerprint ?? '') &&
      consent.offer.backupCertificateFingerprint !== consent.offer.certificateFingerprint,
  );

  const runtime = new AuthenticatedClientRuntime({
    endpoint: consent.endpoint,
    keyStore: new MemoryDeviceKeyStore(),
    sessionStore: new MemorySessionStore(),
    identityProbeTimeoutMs: 500,
    fetchImpl: httpsFetch,
  });
  const startedAt = Date.now();
  const session = await runtime.completePairing({
    endpoint: consent.endpoint,
    endpoints: consent.endpoints.map((endpoint) => endpoint.origin),
    serverId: consent.serverId,
    pairingToken: consent.offer.pairingGrant,
    deviceName: 'LAN E2E Phone',
    platform: 'mobile',
    connectionMode: 'auto',
  });
  check('client falls back and pairs through the live LAN endpoint', session.endpoint === liveOrigin);
  check('dead endpoint fallback is bounded', Date.now() - startedAt < 5_000);

  const projects = await runtime.fetch('/api/projects');
  check('DPoP-authenticated API request succeeds over pinned LAN HTTPS', projects.ok, `status=${projects.status}`);

  const streamUrl = await runtime.buildStreamUrl('global', null);
  check('stream ticket URL uses the selected LAN endpoint', streamUrl.startsWith(`${liveOrigin}/`));
  const streamTicket = new URL(streamUrl).searchParams.get('ticket');
  check('stream ticket was minted', typeof streamTicket === 'string' && streamTicket.length > 0);
  check('stream ticket is not exposed in logs', Boolean(streamTicket) && !logs.join('').includes(streamTicket));

  // A WebSocket upgrade over wss:// with the pinned CA (React Native's Origin is the server's own https origin).
  const ttsUrl = new URL(await runtime.buildSocketUrl('/api/tts/stream', 'tts', null));
  check('socket URL is wss:// on the LAN address', ttsUrl.protocol === 'wss:' && ttsUrl.host === `${lan.address}:${port}`, ttsUrl.href);

  // ── Built-in HTTPS (D-110, D-111) ──
  const httpsOrigin = liveOrigin;
  const secureInfo = await httpsFetch(`${httpsOrigin}/api/auth/server-info`).then((response) => response.json());
  check('the LAN port answers HTTPS with a certificate the local CA issued', secureInfo.tls?.enabled === true);
  check(
    'browser endpoints are https://',
    secureInfo.endpoints?.some((endpoint) => endpoint.origin === httpsOrigin),
    JSON.stringify(secureInfo.endpoints),
  );
  check('the CA fingerprint is published', secureInfo.tls?.caFingerprintSha256 === caFingerprint);

  const webPair = await fetch(`${loopbackOrigin}/api/auth/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ deviceName: 'LAN E2E Browser', platform: 'web' }),
  }).then((response) => response.json());
  check('web pairing response describes the certificate', webPair.tls?.fingerprintSha256 === secureInfo.tls?.fingerprintSha256);
  const webRuntime = new AuthenticatedClientRuntime({
    endpoint: httpsOrigin,
    keyStore: new MemoryDeviceKeyStore(),
    sessionStore: new MemorySessionStore(),
    fetchImpl: httpsFetch,
  });
  const webSession = await webRuntime.completePairing({
    endpoint: httpsOrigin,
    serverId: secureInfo.serverId,
    pairingToken: webPair.shortCode.replace(/-/g, ''),
    deviceName: 'LAN E2E Browser',
    platform: 'web',
    connectionMode: 'auto',
  });
  check('a browser-class client pairs over https:// (DPoP htu https)', webSession.endpoint === httpsOrigin);
  const secureProjects = await webRuntime.fetch('/api/projects');
  check('DPoP-authenticated request succeeds over HTTPS', secureProjects.ok, `status=${secureProjects.status}`);

  const browserOverHttp = await fetch(`${plainLanOrigin}/api/projects`, { headers: { origin: 'http://evil.example' } });
  const refusal = await browserOverHttp.json().catch(() => ({}));
  check('a browser request over plain HTTP from the LAN is refused', browserOverHttp.status === 403 && refusal.error?.code === 'HTTPS_REQUIRED');
  // The native plain-HTTP lane is gone (D-127): no Origin, or the server's own http origin, is refused too.
  for (const headers of [{}, { origin: plainLanOrigin }]) {
    const nativeOverHttp = await fetch(`${plainLanOrigin}/api/auth/server-info`, { headers });
    const body = await nativeOverHttp.json().catch(() => ({}));
    check(
      `a native request over plain HTTP from the LAN is refused (${headers.origin ? 'own Origin' : 'no Origin'})`,
      nativeOverHttp.status === 403 && body.error?.code === 'HTTPS_REQUIRED',
      `${nativeOverHttp.status}`,
    );
  }
  const plainSocket = await new Promise((resolve) => {
    const socket = new UndiciWebSocket(`ws://${lan.address}:${port}/api/tts/stream`);
    socket.addEventListener('open', () => { socket.close(); resolve('open'); });
    socket.addEventListener('error', () => resolve('refused'));
  });
  check('a plain ws:// upgrade from the LAN is refused', plainSocket === 'refused', String(plainSocket));
  const page = await fetch(`${plainLanOrigin}/settings`, { redirect: 'manual' });
  check(
    'a page request over plain HTTP is redirected to https://',
    page.status === 308 && page.headers.get('location') === `${httpsOrigin}/settings`,
    `${page.status} ${page.headers.get('location')}`,
  );
  await pinnedCa.close();
} finally {
  await stop(child);
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
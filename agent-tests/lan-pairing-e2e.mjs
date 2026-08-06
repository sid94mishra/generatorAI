// Real LAN multi-device pairing probe.
// Run: node --import tsx agent-tests/lan-pairing-e2e.mjs

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
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
const liveOrigin = `http://${lan.address}:${port}`;
const deadOrigin = `http://10.255.255.1:${port}`;
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
  const healthy = await waitFor(`${liveOrigin}/api/health`, child);
  check('server is reachable through its LAN interface', healthy, logs.join('').slice(-500));
  if (!healthy) throw new Error('LAN server did not become reachable');

  const info = await fetch(`${liveOrigin}/api/auth/server-info`).then((response) => response.json());
  check('server-info publishes protocol version 2', info.protocolVersion === 2);
  check(
    'server-info includes the live LAN endpoint',
    info.endpoints?.some((endpoint) => endpoint.origin === liveOrigin),
  );
  check('server-info does not claim relay client support', info.transports?.relay === false);

  const pairResponse = await fetch(`${liveOrigin}/api/auth/pair`, {
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

  const runtime = new AuthenticatedClientRuntime({
    endpoint: consent.endpoint,
    keyStore: new MemoryDeviceKeyStore(),
    sessionStore: new MemorySessionStore(),
    identityProbeTimeoutMs: 500,
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
  check('DPoP-authenticated API request succeeds over LAN', projects.ok, `status=${projects.status}`);

  const streamUrl = await runtime.buildStreamUrl('global', null);
  check('stream ticket URL uses the selected LAN endpoint', streamUrl.startsWith(`${liveOrigin}/`));
  const streamTicket = new URL(streamUrl).searchParams.get('ticket');
  check('stream ticket was minted', typeof streamTicket === 'string' && streamTicket.length > 0);
  check('stream ticket is not exposed in logs', Boolean(streamTicket) && !logs.join('').includes(streamTicket));
} finally {
  await stop(child);
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
// ────────────────────────────────────────────────────────────────
// "Connect with Tailscale" end to end, without a real tailnet (D-123–D-125).
//
//   node agent-tests/tailscale-e2e.mjs            (builds nothing; needs apps/web/dist)
//
// An isolated production-mode server (loopback only, scratch DB, dbPath
// asserted) finds a FAKE `tailscale` CLI on PATH (helpers/fake-tailscale —
// on Windows through GENERATORAI_TAILSCALE_CLI) and a TLS proxy that plays
// `tailscale serve` (same headers, a cert from a throwaway CA). Checks:
//   1. every Tailscale state the UI explains: daemon down, signed out,
//      HTTPS off (Tailscale's own enable link, 409), ready;
//   2. Connect runs exactly `serve --bg --https=443 http://127.0.0.1:<port>`,
//      persists, and pairing offers list https://<name>.ts.net first;
//   3. a second browser (Chromium trusting only that leaf via SPKI) opens the
//      ts.net origin: secure context, no warning, pairs by typing the code;
//      DPoP REST, the SSE stream and an authenticated WebSocket work
//      through the proxy;
//   4. forged forwarded headers are ignored: from a non-loopback peer, and
//      from loopback with a Host that is not the ts.net name (rebinding);
//   5. Turn off removes the handler and the name is refused again.
// Not named *.spec.ts so the Playwright runner does not auto-run it.
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import WebSocket from '../apps/server/node_modules/ws/wrapper.mjs';
import { makeTestCertificates, startFakeServe, TAILNET_PEER } from './helpers/fake-tailscale/serve-proxy.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FAKE_DIR = path.join(ROOT, 'agent-tests', 'helpers', 'fake-tailscale');
const TS_NAME = 'gai-e2e.tailnet-fake.ts.net';
const TS_ORIGIN = `https://${TS_NAME}`;
const API_KEY = `tailscale-e2e-admin-${randomBytes(12).toString('hex')}`;
const SHOTS = process.env.SHOTS_DIR ?? path.join(ROOT, 'docs', 'redesign', 'shots', 'tailscale');

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` :: ${String(detail).slice(0, 400)}` : ''}`);
  if (ok) passed += 1;
  else failed += 1;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function privateIpv4() {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (/virtual|vethernet|wsl|docker|default switch|utun|tailscale/i.test(name)) continue;
    for (const a of addresses ?? []) {
      if (!a.internal && a.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address;
    }
  }
  return null;
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'gai-tailscale-e2e-'));
const stateFile = path.join(dataDir, 'fake-tailscale.json');
const setFake = (patch) => {
  const current = JSON.parse(readFileSync(stateFile, 'utf8'));
  writeFileSync(stateFile, JSON.stringify({ ...current, ...patch }, null, 2));
};
const fakeState = () => JSON.parse(readFileSync(stateFile, 'utf8'));
writeFileSync(stateFile, JSON.stringify({ backend: 'Running', dnsName: TS_NAME, https: true, serveTarget: null, calls: [] }));

const port = await freePort();
const widgetPort = await freePort();
const local = `http://127.0.0.1:${port}`;
const logs = [];
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    WIDGET_PORT: String(widgetPort),
    DB_PATH: path.join(dataDir, 'ts.db'),
    WORKSPACES_DIR: path.join(dataDir, 'workspaces'),
    ARTIFACTS_DIR: path.join(dataDir, 'artifacts'),
    EXTENSIONS_DIR: path.join(dataDir, 'extensions'),
    GENERATORAI_EXTENSIONS_DIR: path.join(dataDir, 'extensions'),
    GENERATORAI_SECRETS_DIR: dataDir,
    GENERATORAI_SECRET_KEY: randomBytes(32).toString('base64'),
    GENERATORAI_BIND_HOST: '127.0.0.1',
    GENERATORAI_API_KEY: API_KEY,
    GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK: '0',
    GENERATORAI_TRUST_PROXY: '',
    GENERATORAI_LOOP_PROBE: '0',
    FAKE_TAILSCALE_STATE: stateFile,
    // The fake CLI, found the way the real one is: on PATH (a Node script
    // cannot be spawned bare on Windows, so there it is named explicitly).
    PATH: `${FAKE_DIR}${path.delimiter}${process.env.PATH ?? ''}`,
    ...(process.platform === 'win32' ? { GENERATORAI_TAILSCALE_CLI: path.join(FAKE_DIR, 'tailscale.mjs') } : {}),
    LOG_LEVEL: 'info',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => logs.push(String(d)));
child.stderr.on('data', (d) => logs.push(String(d)));

/** A request with an explicit Host header (fetch forbids setting it). */
function rawGet(p, headers) {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: e.message, body: '' }));
    req.end();
  });
}

const admin = (p, init = {}) =>
  fetch(`${local}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}`, ...(init.headers ?? {}) } });

let proxy = null;
let browser = null;
let page = null;
async function cleanup() {
  await browser?.close().catch(() => {});
  await proxy?.close().catch(() => {});
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise((r) => child.once('exit', r)), new Promise((r) => setTimeout(r, 10_000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

try {
  const deadline = Date.now() + 90_000;
  let up = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      if ((await fetch(`${local}/api/health`)).ok) {
        up = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  check('isolated server is up', up, logs.join('').slice(-800));
  if (!up) throw new Error('server did not start');
  const dbLine = logs.join('').match(/"dbPath":"([^"]+)"/);
  check('server uses the scratch database (dbPath asserted)', dbLine?.[1] === path.join(dataDir, 'ts.db'), dbLine?.[1]);

  // ── 1. States ──
  setFake({ backend: 'down' });
  let s = await (await admin('/api/security/tailscale')).json();
  check('daemon down → not-running', s.state === 'not-running', JSON.stringify(s));
  setFake({ backend: 'NeedsLogin' });
  s = await (await admin('/api/security/tailscale')).json();
  check('signed out → needs-login with Tailscale’s sign-in link', s.state === 'needs-login' && s.loginUrl === 'https://login.tailscale.com/a/fake123', JSON.stringify(s));
  setFake({ backend: 'Running', https: false });
  s = await (await admin('/api/security/tailscale')).json();
  check('HTTPS off → https-disabled', s.state === 'https-disabled', JSON.stringify(s));
  const refused = await admin('/api/security/tailscale', { method: 'POST', body: JSON.stringify({ enabled: true }) });
  const refusedBody = await refused.json();
  check(
    'Connect with HTTPS off → 409 with Tailscale’s own enable link',
    refused.status === 409 && refusedBody.error?.code === 'TAILSCALE_HTTPS_DISABLED' && refusedBody.error?.tailscale?.enableHttpsUrl === 'https://login.tailscale.com/f/serve?node=nFAKE123',
    JSON.stringify(refusedBody),
  );
  setFake({ https: true, calls: [] });
  s = await (await admin('/api/security/tailscale')).json();
  check('everything in place → ready', s.state === 'ready' && s.dnsName === TS_NAME, JSON.stringify(s));
  const limited = await (await fetch(`${local}/api/security/tailscale`)).status;
  check('the status needs a credential', limited === 401, `status=${limited}`);

  // ── 2. Connect ──
  const on = await admin('/api/security/tailscale', { method: 'POST', body: JSON.stringify({ enabled: true }) });
  const onBody = await on.json();
  check('Connect → on, https://<name>.ts.net', on.status === 200 && onBody.state === 'on' && onBody.origin === TS_ORIGIN, JSON.stringify(onBody));
  const serveCall = fakeState().calls.find((c) => c[0] === 'serve' && c[1] === '--bg');
  check('ran exactly: serve --bg --https=443 http://127.0.0.1:<port>', JSON.stringify(serveCall) === JSON.stringify(['serve', '--bg', '--https=443', `http://127.0.0.1:${port}`]), JSON.stringify(serveCall));
  const persisted = JSON.parse(readFileSync(path.join(dataDir, 'tailscale-access.json'), 'utf8'));
  check('the choice is persisted next to the database', persisted.enabled === true && persisted.dnsName === TS_NAME && persisted.port === port, JSON.stringify(persisted));

  const webPair = await (await admin('/api/auth/pair', { method: 'POST', body: JSON.stringify({ platform: 'web', deviceName: 'Laptop via Tailscale' }) })).json();
  check('web pairing joinUrl is the ts.net origin', webPair.joinUrl === TS_ORIGIN, webPair.joinUrl);
  const mobilePair = await (await admin('/api/auth/pair', { method: 'POST', body: JSON.stringify({ platform: 'mobile', deviceName: 'Phone via Tailscale' }) })).json();
  const { decodePairingOffer } = await import('../packages/relay-protocol/src/index.ts');
  const mobileOffer = decodePairingOffer(mobilePair.pairingCode).offer;
  check(
    'a loopback-only server now has a phone endpoint: the ts.net origin, first, private-network',
    mobileOffer?.endpoint === TS_ORIGIN && mobileOffer.endpoints?.[0]?.reachability === 'private-network',
    JSON.stringify(mobileOffer?.endpoints),
  );
  await admin(`/api/auth/pair/${mobilePair.grantId}`, { method: 'DELETE' });

  // ── 3. Second browser through the proxy ──
  const certs = await makeTestCertificates(TS_NAME);
  proxy = await startFakeServe({ stateFile, certPem: certs.certPem, keyPem: certs.keyPem });
  browser = await chromium
    .launch({
      channel: 'chrome',
      args: [`--host-resolver-rules=MAP ${TS_NAME} 127.0.0.1:${proxy.port}`, `--ignore-certificate-errors-spki-list=${certs.spkiSha256Base64}`],
    })
    .catch(() =>
      chromium.launch({ args: [`--host-resolver-rules=MAP ${TS_NAME} 127.0.0.1:${proxy.port}`, `--ignore-certificate-errors-spki-list=${certs.spkiSha256Base64}`] }),
    );
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  const streamResponses = [];
  page.on('response', (r) => {
    if ((r.headers()['content-type'] ?? '').includes('text/event-stream')) streamResponses.push(r.status());
  });
  const response = await page.goto(`${TS_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  check('the ts.net page loads with no certificate warning', response?.ok() === true, `status=${response?.status()}`);
  const secure = await page.evaluate(() => ({ secure: window.isSecureContext, subtle: Boolean(globalThis.crypto?.subtle), origin: location.origin }));
  check('isSecureContext and WebCrypto on the ts.net origin', secure.secure && secure.subtle && secure.origin === TS_ORIGIN, JSON.stringify(secure));
  await page.getByTestId('pairing-gate').waitFor({ timeout: 30_000 });
  check('no fingerprint-comparison hint on a publicly trusted name', (await page.getByTestId('pairing-certificate-hint').count()) === 0);

  const code = webPair.shortCode.replace(/[^A-Za-z0-9]/g, '');
  await page.getByRole('textbox', { name: 'Pairing code', exact: true }).click();
  await page.keyboard.type(code, { delay: 20 });
  await page.getByText('You are about to connect to:').waitFor({ timeout: 20_000 });
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, 'browser-pairing-over-tailscale.png') });
  await page.getByLabel('Name this device').fill('Laptop via Tailscale');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="pairing-gate"]') && (document.querySelector('#root')?.children.length ?? 0) > 0, null, { timeout: 60_000 });
  check('paired over https://<name>.ts.net by typing the code', true);
  // Pairing ends with a reload into the app; let it install its signed fetch.
  await page.waitForLoadState('networkidle').catch(() => {});

  const devices = await (await admin('/api/auth/devices')).json();
  const device = devices.devices?.find((d) => d.name === 'Laptop via Tailscale');
  check('the device is registered (platform web)', device?.platform === 'web', JSON.stringify(devices.devices?.map((d) => d.name)));

  // DPoP REST through the proxy (the page's fetch signs /api calls).
  let rest = null;
  for (let attempt = 0; attempt < 6 && !rest; attempt += 1) {
    rest = await page
      .evaluate(async () => {
        const r = await fetch('/api/auth/devices/me');
        return { status: r.status, body: await r.json().catch(() => null) };
      })
      .catch(async (err) => {
        if (!/context was destroyed|navigation/i.test(String(err))) throw err;
        await new Promise((r) => setTimeout(r, 1000));
        return null;
      });
  }
  check('DPoP-signed REST over the proxy (htu https://<name>.ts.net)', rest.status === 200 && rest.body?.name === 'Laptop via Tailscale', JSON.stringify(rest));

  await page.waitForTimeout(3000);
  check('the live SSE stream opened through the proxy', streamResponses.includes(200), JSON.stringify(streamResponses));

  const ws = await page.evaluate(async () => {
    const t = await fetch('/api/stream/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'stt' }) });
    const body = await t.json();
    if (!t.ok) return { error: `ticket ${t.status} ${JSON.stringify(body)}` };
    return new Promise((resolve) => {
      const socket = new WebSocket(`wss://${location.host}/api/stt/stream?ticket=${encodeURIComponent(body.ticket)}`);
      socket.onopen = () => {
        socket.close();
        resolve({ opened: true });
      };
      socket.onerror = () => resolve({ opened: false });
      setTimeout(() => resolve({ opened: false, timeout: true }), 10_000);
    });
  });
  check('an authenticated WebSocket (ticket) upgrades through the proxy', ws.opened === true, JSON.stringify(ws));

  // CORS: a same-origin POST carries Origin https://<name>.ts.net.
  const cors = await page.evaluate(async () => (await fetch('/api/stream/tickets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'global' }) })).status);
  check('CORS accepts the ts.net Origin', cors === 200 || cors === 201, `status=${cors}`);
  check('no console errors on the paired page', consoleErrors.length === 0, consoleErrors.join(' | '));
  await page.screenshot({ path: path.join(SHOTS, 'browser-paired-over-tailscale.png') });

  // The Tailscale-User-* headers the proxy added granted nothing: an
  // unauthenticated request through the proxy is still 401.
  const anonStatus = await new Promise((resolve) => {
    const req = httpsRequest({ host: '127.0.0.1', port: proxy.port, path: '/api/projects', servername: TS_NAME, headers: { host: TS_NAME }, rejectUnauthorized: false }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', (e) => resolve(e.message));
    req.end();
  });
  check('Tailscale-User-* identity headers authorise nothing (401 without a device credential)', anonStatus === 401, String(anonStatus));

  // WebSocket upgrade without a ticket reaches authentication (Host + Origin passed), a foreign Origin does not.
  const upgrade = (origin) =>
    new Promise((resolve) => {
      const sock = new WebSocket(`wss://127.0.0.1:${proxy.port}/api/stt/stream`, { headers: { host: TS_NAME, origin }, servername: TS_NAME, rejectUnauthorized: false });
      sock.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      sock.on('open', () => resolve('open'));
      sock.on('error', (e) => resolve(e.message));
    });
  check('WS upgrade from the ts.net Origin reaches authentication (401)', (await upgrade(TS_ORIGIN)) === 401);
  check('WS upgrade from a foreign Origin is refused (403)', (await upgrade('https://evil.example')) === 403);

  // ── 4. Forged forwarded headers ──
  const forgedLoopback = await rawGet('/api/auth/server-info', { host: 'evil.example', 'x-forwarded-host': TS_NAME, 'x-forwarded-proto': 'https' });
  check('loopback + forged X-Forwarded-Host but a foreign Host → 421 (rebinding stays blocked)', forgedLoopback.status === 421, `status=${forgedLoopback.status}`);
  const direct = await rawGet('/api/auth/server-info', { host: TS_NAME, 'x-forwarded-proto': 'https', 'x-forwarded-for': TAILNET_PEER });
  const directInfo = JSON.parse(direct.body || '{}');
  check('the lane: loopback + Host = ts.net name → https:// endpoint', directInfo.endpoints?.[0]?.origin === TS_ORIGIN, JSON.stringify(directInfo.endpoints));
  const lan = privateIpv4();
  if (lan) {
    // A second, LAN-bound server is not needed: the loopback-only server does
    // not listen on the LAN, so a non-loopback peer cannot even connect. The
    // unit tests (tailscaleAccess.test.ts) cover a non-loopback peer sending
    // the same headers; here we confirm the port is closed to it.
    const lanReach = await fetch(`http://${lan}:${port}/api/health`, { signal: AbortSignal.timeout(3000) }).then(
      (r) => r.status,
      () => 'refused',
    );
    check('a non-loopback peer cannot reach the loopback-only server at all', lanReach === 'refused', String(lanReach));
  }

  // ── 5. Turn off ──
  const off = await (await admin('/api/security/tailscale', { method: 'POST', body: JSON.stringify({ enabled: false }) })).json();
  check('Turn off → handler removed, state ready', off.state === 'ready' && fakeState().serveTarget === null, JSON.stringify(off));
  const after = await rawGet('/api/auth/server-info', { host: TS_NAME });
  check('after Turn off the ts.net name is refused (421)', after.status === 421, `status=${after.status}`);
  const audit = await (await admin('/api/auth/audit?limit=50')).json().catch(() => null);
  const audited = JSON.stringify(audit ?? '').includes('tailscale-access');
  check('connect and turn-off are audited', audited, JSON.stringify(audit).slice(0, 300));
} catch (err) {
  check('spec ran to completion', false, err instanceof Error ? err.stack : String(err));
  if (page) {
    const failShot = path.join(tmpdir(), `tailscale-e2e-failure-${Date.now()}.png`);
    await page.screenshot({ path: failShot }).catch(() => {});
    console.log(`  failure screenshot: ${failShot}\n  page text: ${(await page.locator('body').innerText().catch(() => '')).slice(0, 600)}`);
  }
} finally {
  await cleanup();
}
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

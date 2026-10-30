// ────────────────────────────────────────────────────────────────
// Desktop app as a client of ANOTHER machine's server, with its CA pinned
// (G-4, D-126).
//
//   node --import tsx agent-tests/desktop-pinned-client-smoke.mjs
//        (needs apps/desktop dist + apps/web/dist; a private LAN address)
//
// Server A: an isolated production server with Network exposure on, so it
// serves its own D-110 CA's certificate on https://<lan-ip>:<port>.
// Desktop B: the real Electron shell on an isolated profile (its own embedded
// server). Like a user, B opens Connect to a server…, pastes A's Desktop
// pairing link, sees "Trust this server?" with the fingerprint (dialog
// captured), and the window loads A over HTTPS — trusted through the pinned
// CA only — and pairs. Then A switches to a certificate from ANOTHER CA for
// the same address: B refuses it. Back on A's own certificate, B loads again.
// Not named *.spec.ts so the Playwright runner does not auto-run it.
// ────────────────────────────────────────────────────────────────

import { _electron as electron } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DESKTOP_DIR as DESKTOP, REPO_ROOT, isolatedProfile } from './helpers/desktop-profile.mjs';
import { generateLocalCa, issueLeafCertificate } from '../apps/server/src/network/tls/certificates.ts';

const SHOTS = process.env.SHOTS_DIR ?? path.join(REPO_ROOT, 'docs', 'redesign', 'shots', 'tailscale');
const API_KEY = `pinned-client-${randomBytes(12).toString('hex')}`;
let passed = 0;
let failed = 0;
const record = (name, ok, info = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info && !ok ? ` :: ${String(info).slice(0, 500)}` : ''}`);
};

function lanAddress() {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (/virtual|vethernet|wsl|docker|default switch|utun|tailscale/i.test(name)) continue;
    for (const a of addresses ?? []) {
      if (!a.internal && a.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address;
    }
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const lan = lanAddress();
if (!lan) {
  console.error('No private IPv4 address: this smoke needs one (Wi-Fi or Ethernet).');
  process.exit(1);
}

// ── Server A ──
const dataDir = mkdtempSync(path.join(tmpdir(), 'gai-pinned-server-'));
const port = await freePort();
const widgetPort = await freePort();
const local = `http://127.0.0.1:${port}`;
const remote = `https://${lan}:${port}`;
const logs = [];
const serverA = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
  cwd: REPO_ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    WIDGET_PORT: String(widgetPort),
    DB_PATH: path.join(dataDir, 'a.db'),
    WORKSPACES_DIR: path.join(dataDir, 'workspaces'),
    ARTIFACTS_DIR: path.join(dataDir, 'artifacts'),
    EXTENSIONS_DIR: path.join(dataDir, 'extensions'),
    GENERATORAI_EXTENSIONS_DIR: path.join(dataDir, 'extensions'),
    GENERATORAI_SECRETS_DIR: dataDir,
    GENERATORAI_SECRET_KEY: randomBytes(32).toString('base64'),
    GENERATORAI_BIND_HOST: '0.0.0.0',
    GENERATORAI_API_KEY: API_KEY,
    GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK: '0',
    GENERATORAI_LOOP_PROBE: '0',
    GENERATORAI_SERVER_NAME: 'Studio A',
    GENERATORAI_STT: '0',
    GENERATORAI_TTS: '0',
    LOG_LEVEL: 'info',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
serverA.stdout.on('data', (d) => logs.push(String(d)));
serverA.stderr.on('data', (d) => logs.push(String(d)));
const admin = (p, init = {}) => fetch(`${local}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}`, ...(init.headers ?? {}) } });

const profile = isolatedProfile('gai-pinned-client-');
let app = null;
let page = null;

async function stopAll() {
  try {
    await app?.close();
  } catch {
    /* gone */
  }
  profile.cleanup();
  if (serverA.exitCode === null) {
    serverA.kill('SIGTERM');
    await Promise.race([new Promise((r) => serverA.once('exit', r)), new Promise((r) => setTimeout(r, 10_000))]);
    if (serverA.exitCode === null) serverA.kill('SIGKILL');
  }
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

try {
  let up = false;
  for (let i = 0; i < 300 && !up && serverA.exitCode === null; i += 1) {
    up = await fetch(`${local}/api/health`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  record('server A is up', up, logs.join('').slice(-600));
  if (!up) throw new Error('server A did not start');
  const dbPath = logs.join('').match(/"dbPath":"([^"]+)"/)?.[1];
  record('server A uses the scratch database (dbPath asserted)', dbPath === path.join(dataDir, 'a.db'), dbPath);
  const network = await (await admin('/api/security/network-access')).json();
  record('server A serves its own CA’s certificate on the LAN', network.tls?.enabled === true && network.tls?.source === 'generated', JSON.stringify(network.tls));
  const pairing = await (await admin('/api/auth/pair', { method: 'POST', body: JSON.stringify({ platform: 'desktop', deviceName: 'Desktop B' }) })).json();
  record('a Desktop pairing link names the https:// address first', pairing.joinUrl === remote, pairing.joinUrl);

  // ── Desktop B ──
  const ELECTRON = createRequire(path.join(DESKTOP, 'package.json'))('electron');
  app = await electron.launch({ executablePath: ELECTRON, args: ['.', profile.arg], cwd: DESKTOP, env: { ...process.env, GENERATORAI_DESKTOP_MODE: 'standalone', GENERATORAI_STT: '0', GENERATORAI_TTS: '0' }, timeout: 120_000 });
  profile.attach(app);
  for (let i = 0; i < 200 && !page; i += 1) {
    page = app.windows().find((w) => w.url().startsWith('http://127.0.0.1')) ?? null;
    if (!page) await new Promise((r) => setTimeout(r, 800));
  }
  record('desktop B opens on its own embedded server', Boolean(page), JSON.stringify(app.windows().map((w) => w.url())));
  if (!page) throw new Error('no window');
  await page.waitForLoadState('networkidle').catch(() => {});

  // Capture the "Trust this server?" dialog instead of clicking a native box.
  await app.evaluate(({ dialog }) => {
    globalThis.__dialogs = [];
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1);
      globalThis.__dialogs.push({ title: options.title, message: options.message, detail: options.detail, buttons: options.buttons });
      return { response: 0, checkboxChecked: false };
    };
  });

  await page.evaluate(() => {
    void window.generatoraiDesktop.servers.add();
  });
  let prompt = null;
  for (let i = 0; i < 60 && !prompt; i += 1) {
    prompt = app.windows().find((w) => w.url().includes('prompt.html')) ?? null;
    if (!prompt) await new Promise((r) => setTimeout(r, 500));
  }
  record('Connect to a server… opens', Boolean(prompt));
  await prompt.locator('#value').fill(pairing.pairingUrl);
  await prompt.locator('#ok').click();

  let dialogs = [];
  for (let i = 0; i < 60 && dialogs.length === 0; i += 1) {
    dialogs = await app.evaluate(() => globalThis.__dialogs ?? []);
    if (dialogs.length === 0) await new Promise((r) => setTimeout(r, 500));
  }
  const trust = dialogs.find((d) => d.title === 'Trust this server?');
  const leafPairs = network.tls.fingerprintSha256.replace(/:/g, ' ');
  record('a "Trust this server?" step names the server and shows the fingerprint', Boolean(trust?.message.includes('Studio A') && trust.detail.includes(leafPairs)), JSON.stringify(dialogs));
  record('…and says the pairing code vouches for it', Boolean(trust?.detail.includes('It matches the pairing code')), trust?.detail);

  for (let i = 0; i < 60 && !page.url().startsWith(remote); i += 1) await new Promise((r) => setTimeout(r, 500));
  record('the window loads server A over https:// (pinned CA accepted)', page.url().startsWith(remote), page.url());
  await page.getByText('You are about to connect to:').waitFor({ timeout: 45_000 });
  const secure = await page.evaluate(() => window.isSecureContext && Boolean(crypto.subtle));
  record('server A’s page is a secure context in desktop B', secure);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-client-pairing-pinned.png') });
  await page.getByLabel('Name this device').fill('Desktop B');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="pairing-gate"]') && (document.querySelector('#root')?.children.length ?? 0) > 0, null, { timeout: 60_000 });
  const devices = await (await admin('/api/auth/devices')).json();
  record('desktop B paired with server A', devices.devices?.some((d) => d.name === 'Desktop B'), JSON.stringify(devices.devices?.map((d) => d.name)));

  const settings = JSON.parse(readFileSync(path.join(profile.dir, 'settings.json'), 'utf8'));
  const saved = settings.servers.connections.find((c) => c.url === remote);
  record('the server is saved with its pinned CA (= the code’s fingerprint)', saved?.pinnedCa?.sha256 && saved.pinnedCa.sha256 === Buffer.from(network.tls.caFingerprintSha256.replace(/:/g, ''), 'hex').toString('base64url'), JSON.stringify(saved?.pinnedCa?.sha256));

  // ── A different certificate for the same address is refused ──
  const otherCa = await generateLocalCa({ commonName: 'Someone else’s CA' });
  const impostor = await issueLeafCertificate({ ca: otherCa, names: { dnsNames: [], ipAddresses: [lan] }, commonName: lan });
  const installed = await admin('/api/security/tls/certificate', { method: 'PUT', body: JSON.stringify({ certificatePem: impostor.certPem + otherCa.certPem, privateKeyPem: impostor.keyPem }) });
  record('server A now serves a certificate from another CA for the same address', installed.status === 200, await installed.text());
  // A real impersonator is a new connection: drop the window's kept-alive sockets.
  await app.evaluate(async ({ session }) => {
    await session.defaultSession.closeAllConnections();
    await session.defaultSession.clearCache();
  });
  const refused = await page.reload({ timeout: 30_000 }).then(
    (r) => `loaded ${r?.status()}`,
    (err) => String(err.message ?? err),
  );
  const shown = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  record('desktop B refuses it (certificate error, nothing loads)', /ERR_CERT/.test(refused), `${refused} | ${shown.slice(0, 120)}`);

  await admin('/api/security/tls/certificate', { method: 'DELETE' });
  await app.evaluate(async ({ session }) => {
    await session.defaultSession.closeAllConnections();
  });
  await page.goto(`${remote}/`, { timeout: 30_000 }).catch(() => {});
  await page.waitForFunction(() => (document.querySelector('#root')?.children.length ?? 0) > 0, null, { timeout: 45_000 }).catch(() => {});
  record('back on its own CA, server A loads again', page.url().startsWith(remote) && (await page.evaluate(() => window.isSecureContext).catch(() => false)), page.url());
} catch (err) {
  record('smoke ran to completion', false, err instanceof Error ? err.stack : String(err));
  if (page) {
    const shot = path.join(tmpdir(), `pinned-client-failure-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    console.log(`  failure screenshot: ${shot} (${page.url()})\n  text: ${(await page.locator('body').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 900)}`);
  }
  try {
    const log = readFileSync(path.join(profile.dir, 'logs', 'main.log'), 'utf8');
    console.log(log.split('\n').filter((l) => /Loading app URL|ready|failed|Error|error/.test(l)).slice(-25).join('\n'));
  } catch {
    /* no log */
  }
}
await stopAll();
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

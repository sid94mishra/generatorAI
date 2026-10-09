// ────────────────────────────────────────────────────────────────
// Desktop "Connect with Tailscale" smoke (D-123, D-124).
//
//   node agent-tests/desktop-tailscale-smoke.mjs     (needs apps/desktop dist + apps/web/dist)
//
// The real Electron shell (isolated profile, embedded server) with a FAKE
// `tailscale` CLI on PATH (helpers/fake-tailscale) and a local TLS proxy
// playing `tailscale serve`. Like a user:
//   1. Settings › Security & devices › Access from other devices shows
//      "HTTPS off"; Connect surfaces Tailscale's own enable link;
//   2. after HTTPS is on, Connect with Tailscale → On, the ts.net address;
//   3. Pair a new device (Web browser) shows the ts.net address first with
//      "Works on any network where your devices are signed in to Tailscale";
//   4. a second browser opens that address (secure context, no warning) and
//      pairs by typing the code;
//   5. the embedded server restarts after its Serve target went stale (a
//      port change) and re-applies it; the second browser still works;
//   6. Turn off removes the handler.
// Not named *.spec.ts so the Playwright runner does not auto-run it.
// ────────────────────────────────────────────────────────────────

import { _electron as electron, chromium } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DESKTOP_DIR as DESKTOP, REPO_ROOT, isolatedProfile } from './helpers/desktop-profile.mjs';
import { makeTestCertificates, startFakeServe } from './helpers/fake-tailscale/serve-proxy.mjs';

const FAKE_DIR = path.join(REPO_ROOT, 'agent-tests', 'helpers', 'fake-tailscale');
const TS_NAME = 'gai-desktop.tailnet-fake.ts.net';
const TS_ORIGIN = `https://${TS_NAME}`;
const SHOTS = process.env.SHOTS_DIR ?? path.join(REPO_ROOT, 'docs', 'redesign', 'shots', 'tailscale');
mkdirSync(SHOTS, { recursive: true });

const profile = isolatedProfile('gai-tailscale-smoke-');
const fakeDir = mkdtempSync(path.join(tmpdir(), 'gai-fake-tailscale-'));
const stateFile = path.join(fakeDir, 'state.json');
writeFileSync(stateFile, JSON.stringify({ backend: 'Running', dnsName: TS_NAME, https: false, serveTarget: null, calls: [] }));
const fake = () => JSON.parse(readFileSync(stateFile, 'utf8'));
const setFake = (patch) => writeFileSync(stateFile, JSON.stringify({ ...fake(), ...patch }, null, 2));
process.on('exit', () => {
  profile.cleanup();
  rmSync(fakeDir, { recursive: true, force: true });
});

const ELECTRON = createRequire(path.join(DESKTOP, 'package.json'))('electron');
let passed = 0;
let failed = 0;
const record = (name, ok, info = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info && !ok ? ` :: ${String(info).slice(0, 400)}` : ''}`);
};

const app = await electron.launch({
  executablePath: ELECTRON,
  args: ['.', profile.arg],
  cwd: DESKTOP,
  env: {
    ...process.env,
    GENERATORAI_DESKTOP_MODE: 'standalone',
    // Voice models load for a minute on a busy machine; nothing here needs them.
    GENERATORAI_STT: '0',
    GENERATORAI_TTS: '0',
    FAKE_TAILSCALE_STATE: stateFile,
    PATH: `${FAKE_DIR}${path.delimiter}${process.env.PATH ?? ''}`,
    ...(process.platform === 'win32' ? { GENERATORAI_TAILSCALE_CLI: path.join(FAKE_DIR, 'tailscale.mjs') } : {}),
  },
  timeout: 90_000,
});
profile.attach(app);

let proxy = null;
let browser = null;

async function mainWindow() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      let url = '';
      try {
        url = w.url();
      } catch {
        /* transitioning */
      }
      if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) return w;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

/** A signed API call from the page (its fetch signs /api); retried across the post-pairing reload. */
async function signed(page, p, init) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await page.waitForFunction(() => (document.querySelector('#root')?.children.length ?? 0) > 0, null, { timeout: 30_000 });
      return await page.evaluate(
        async ([u, i]) => {
          const r = await fetch(u, i ?? undefined);
          return { status: r.status, body: await r.json().catch(() => null) };
        },
        [p, init ?? null],
      );
    } catch (err) {
      if (attempt >= 5 || !/context was destroyed|navigation/i.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

let page = null;
try {
  page = await mainWindow();
  record('main window appears over loopback', Boolean(page), page?.url());
  if (!page) throw new Error('no window');
  const origin = new URL(page.url()).origin;
  const port = Number(new URL(origin).port);
  await page.waitForFunction(() => !document.querySelector('[data-testid="pairing-gate"]') && (document.querySelector('#root')?.children.length ?? 0) > 0, null, { timeout: 60_000 });
  await page.setViewportSize?.({ width: 1440, height: 900 }).catch(() => {});
  // The shell pairs its own window after the first load; wait until it has
  // (navigating away mid-pairing would leave the window on the pairing screen).
  let paired = false;
  for (let i = 0; i < 60 && !paired; i += 1) {
    paired = (await signed(page, '/api/auth/devices/me').catch(() => ({ status: 0 }))).status === 200;
    if (!paired) await new Promise((r) => setTimeout(r, 1000));
  }
  record('the desktop window paired itself', paired);
  // …and has finished its post-pairing reload.
  await page.waitForLoadState('networkidle').catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));

  // ── 1. HTTPS off ──
  for (let i = 0; i < 5; i += 1) {
    try {
      await page.goto(`${origin}/settings/security`);
      break;
    } catch (err) {
      if (!/interrupted/.test(String(err)) || i === 4) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  const card = page.getByTestId('security-tailscale');
  await card.waitFor({ timeout: 30_000 });
  await card.getByText('HTTPS off').waitFor({ timeout: 20_000 });
  record('Tailscale card shows "HTTPS off" with a link to turn it on', (await card.getByRole('link', { name: /Turn on HTTPS/ }).count()) === 1);
  await card.getByRole('button', { name: 'Connect with Tailscale' }).click();
  const enableLink = card.getByRole('link', { name: /Turn on HTTPS/ });
  // The refused Connect is refetched; Tailscale's node-specific link replaces the generic one.
  let href = null;
  for (let i = 0; i < 60 && href !== 'https://login.tailscale.com/f/serve?node=nFAKE123'; i += 1) {
    href = await enableLink.getAttribute('href').catch(() => null);
    await new Promise((r) => setTimeout(r, 500));
  }
  await card.getByRole('button', { name: 'Connect with Tailscale', disabled: false }).waitFor({ timeout: 30_000 }).catch(() => {});
  record('Connect with HTTPS off → Tailscale’s own enable link is offered', href === 'https://login.tailscale.com/f/serve?node=nFAKE123', href);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'desktop-settings-tailscale-https-off.png') });

  // ── 2. Connect ──
  setFake({ https: true });
  await card.getByRole('button', { name: 'Check Tailscale again' }).click();
  await card.getByText('Ready').waitFor({ timeout: 60_000 });
  await card.getByRole('button', { name: 'Connect with Tailscale' }).click();
  const address = card.getByTestId('security-tailscale-address');
  await address.waitFor({ timeout: 90_000 });
  record('Connect with Tailscale → On with the ts.net address', (await address.textContent())?.trim() === TS_ORIGIN, await address.textContent());
  record('the CLI ran serve to this server’s loopback port', fake().serveTarget === `http://127.0.0.1:${port}`, fake().serveTarget);
  record('Network exposure stays off (Tailscale does not need it)', (await signed(page, '/api/security/network-access')).body?.active === false);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'desktop-settings-tailscale-on.png') });

  // ── 3. Pair a new device ──
  const pair = page.getByTestId('security-pair');
  await pair.scrollIntoViewIfNeeded();
  await pair.getByLabel('Device name').fill('Laptop via Tailscale');
  await pair.getByRole('combobox', { name: 'Platform' }).click();
  await page.getByRole('option', { name: 'Web browser' }).click();
  await pair.getByRole('button', { name: 'Generate pairing code' }).click();
  const panel = page.getByTestId('security-pairing-code');
  await panel.waitFor({ timeout: 20_000 });
  const joinText = await panel.locator('.font-mono').first().textContent();
  record('the pairing panel lists the ts.net address first', joinText?.trim() === TS_ORIGIN, joinText);
  record('…with "Works on any network where your devices are signed in to Tailscale"', (await page.getByTestId('security-pairing-tailscale').textContent())?.includes('Works on any network where your devices are signed in to Tailscale'));
  record('…and no certificate-comparison note', (await page.getByTestId('security-certificate-check').count()) === 0);
  const code = (await panel.locator('input').evaluateAll((inputs) => inputs.map((i) => i.value).join(''))).slice(0, 12);
  record('a 12-character code is shown', /^[A-Z0-9]{12}$/.test(code), code);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'desktop-pairing-panel-tailscale.png') });

  // ── 4. Second browser through the fake `tailscale serve` ──
  const certs = await makeTestCertificates(TS_NAME);
  proxy = await startFakeServe({ stateFile, certPem: certs.certPem, keyPem: certs.keyPem });
  const args = [`--host-resolver-rules=MAP ${TS_NAME} 127.0.0.1:${proxy.port}`, `--ignore-certificate-errors-spki-list=${certs.spkiSha256Base64}`];
  browser = await chromium.launch({ channel: 'chrome', args }).catch(() => chromium.launch({ args }));
  const other = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const res = await other.goto(`${TS_ORIGIN}/`);
  record('the other device opens the ts.net address with no warning', res?.ok() === true, res?.status());
  const ctx = await other.evaluate(() => ({ secure: window.isSecureContext, subtle: Boolean(crypto?.subtle) }));
  record('…in a secure context with WebCrypto', ctx.secure && ctx.subtle, JSON.stringify(ctx));
  await other.getByTestId('pairing-gate').waitFor({ timeout: 30_000 });
  await other.getByRole('textbox', { name: 'Pairing code', exact: true }).click();
  await other.keyboard.type(code, { delay: 20 });
  await other.getByText('You are about to connect to:').waitFor({ timeout: 20_000 });
  await other.getByLabel('Name this device').fill('Phone browser via Tailscale');
  await other.getByRole('button', { name: 'Connect' }).click();
  await other.waitForFunction(() => !document.querySelector('[data-testid="pairing-gate"]') && (document.querySelector('#root')?.children.length ?? 0) > 0, null, { timeout: 60_000 });
  await other.waitForLoadState('networkidle').catch(() => {});
  const me = await signed(other, '/api/auth/devices/me');
  record('the other device paired over Tailscale and its DPoP calls work', me.status === 200 && me.body?.name === 'Phone browser via Tailscale', JSON.stringify(me));
  await other.screenshot({ path: path.join(SHOTS, 'phone-browser-paired-over-tailscale.png') });

  // ── 5. Re-apply after a restart with a stale Serve target ──
  const accessFile = path.join(profile.dir, 'data', 'tailscale-access.json');
  const persisted = JSON.parse(readFileSync(accessFile, 'utf8'));
  record('the choice is persisted in the profile’s data directory', persisted.enabled === true && persisted.port === port, JSON.stringify(persisted));
  const stalePort = port + 1000;
  writeFileSync(accessFile, JSON.stringify({ ...persisted, port: stalePort }));
  setFake({ serveTarget: `http://127.0.0.1:${stalePort}` });
  const servesBefore = fake().calls.filter((c) => c[1] === '--bg').length;
  await page.evaluate(() => window.generatoraiDesktop?.restartServer?.());
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && fake().serveTarget !== `http://127.0.0.1:${port}`) await new Promise((r) => setTimeout(r, 1000));
  record('after a restart the server re-points Serve at its port', fake().serveTarget === `http://127.0.0.1:${port}` && fake().calls.filter((c) => c[1] === '--bg').length > servesBefore, fake().serveTarget);
  await other.reload();
  await other.waitForFunction(() => (document.querySelector('#root')?.children.length ?? 0) > 0, null, { timeout: 60_000 });
  await other.waitForLoadState('networkidle').catch(() => {});
  record('the other device still works after the restart', (await signed(other, '/api/auth/devices/me')).status === 200);

  // ── 6. Turn off ──
  await page.goto(`${origin}/settings/security`);
  await page.getByTestId('security-tailscale').getByRole('button', { name: 'Turn off Tailscale access' }).click();
  // Each CLI call is a process start; give a loaded machine time.
  await page.getByTestId('security-tailscale').getByRole('button', { name: 'Connect with Tailscale' }).waitFor({ timeout: 90_000 });
  record('Turn off removes the Serve handler', fake().serveTarget === null, fake().serveTarget);
} catch (err) {
  record('smoke ran to completion', false, err instanceof Error ? err.stack : String(err));
  if (page) {
    const shot = path.join(tmpdir(), `desktop-tailscale-failure-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    console.log(`  failure screenshot: ${shot} (${page.url()})`);
  }
  try {
    const log = readFileSync(path.join(profile.dir, 'logs', 'main.log'), 'utf8');
    console.log(log.split('\n').filter((l) => /tailscale|Tailscale|error|Error/.test(l)).slice(-30).join('\n'));
    console.log('fake calls:', JSON.stringify(fake().calls));
  } catch {
    /* no log */
  }
}
await browser?.close().catch(() => {});
await proxy?.close().catch(() => {});
console.log(`\n  ${passed} passed, ${failed} failed\n`);
try {
  await app.close();
} catch {
  /* already gone */
}
profile.cleanup();
rmSync(fakeDir, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);

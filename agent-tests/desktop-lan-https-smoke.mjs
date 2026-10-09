// ────────────────────────────────────────────────────────────────
// Desktop LAN HTTPS smoke (D-110, D-111).
//
//   node agent-tests/desktop-lan-https-smoke.mjs
//
// Launches the real Electron shell (isolated profile, embedded server), turns
// Network exposure on from Settings › Security & devices like a user, and
// checks that:
//   1. the shell restarts its server and the window keeps working over plain
//      HTTP on loopback;
//   2. the settings show the https:// LAN address and the certificate
//      fingerprint;
//   3. the LAN address really answers HTTPS with that certificate, and a
//      browser page over plain HTTP is redirected there.
// Turning exposure back off is the last step, so the embedded server ends
// loopback-only even if the profile were reused.
//
// Not named *.spec.ts so the Playwright runner does not auto-run it.
// ────────────────────────────────────────────────────────────────

import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import tls from 'node:tls';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { DESKTOP_DIR as DESKTOP, REPO_ROOT, isolatedProfile } from './helpers/desktop-profile.mjs';

const profile = isolatedProfile('gai-lan-https-smoke-');
process.on('exit', profile.cleanup);
const requireFromDesktop = createRequire(path.join(DESKTOP, 'package.json'));
const ELECTRON = requireFromDesktop('electron');
const SHOTS = process.env.SHOTS_DIR ?? path.join(REPO_ROOT, 'docs', 'redesign', 'shots', 'lan-https');

let passed = 0;
let failed = 0;
const record = (name, ok, info = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ` :: ${info}` : ''}`);
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

function peerFingerprint(host, port) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
      resolve(socket.getPeerCertificate().fingerprint256);
      socket.end();
    });
    socket.on('error', (err) => resolve(`error: ${err.message}`));
  });
}

const app = await electron.launch({
  executablePath: ELECTRON,
  args: ['.', profile.arg],
  cwd: DESKTOP,
  env: { ...process.env, GENERATORAI_DESKTOP_MODE: 'standalone' },
  timeout: 90_000,
});
profile.attach(app);

async function finish() {
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  try {
    await app.close();
  } catch {
    /* already gone */
  }
  profile.cleanup();
  process.exit(failed === 0 ? 0 : 1);
}

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

try {
  const page = await mainWindow();
  record('main window appears over loopback', Boolean(page), page?.url());
  if (!page) throw new Error('no window');
  const origin = new URL(page.url()).origin;
  const port = Number(new URL(origin).port);
  await page
    .waitForFunction(() => !document.querySelector('[data-testid="pairing-gate"]') && document.querySelector('#root')?.children.length > 0, {
      timeout: 60_000,
    })
    .catch(() => {});

  // ── Turn Network exposure on, like a user ──
  await page.goto(`${origin}/settings/security`);
  // Network exposure lives under Access from other devices › Advanced (D-123),
  // closed while the server is loopback-only.
  const advanced = page.getByRole('button', { name: 'Advanced: Network exposure (LAN)' });
  await advanced.waitFor({ timeout: 30_000 });
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
  const network = page.getByTestId('security-network');
  await network.waitFor({ timeout: 30_000 });
  await network.getByRole('radio', { name: 'LAN' }).click();

  // The shell restarts its server (same remembered port) and repoints the window.
  const deadline = Date.now() + 90_000;
  let access = null;
  while (Date.now() < deadline) {
    access = await page
      .evaluate(async (o) => {
        const r = await fetch(`${o}/api/security/network-access`);
        return r.ok ? r.json() : null;
      }, origin)
      .catch(() => null);
    if (access?.active && access.tls?.enabled) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  record('server restarted network-accessible with HTTPS', Boolean(access?.active && access?.tls?.enabled), JSON.stringify(access?.tls ?? access));
  record('the window still talks plain HTTP over loopback', page.url().startsWith(`http://127.0.0.1:${port}`) || page.url().startsWith(`http://localhost:${port}`), page.url());

  await page.goto(`${origin}/settings/security`);
  await page.getByTestId('security-certificate').waitFor({ timeout: 30_000 });
  const lan = lanAddress();
  const networkText = await page.getByTestId('security-network').innerText();
  record('Settings shows the https:// LAN address', lan ? networkText.includes(`https://${lan}:${port}`) : networkText.includes('https://'), networkText.split('\n').find((l) => l.includes('https://')) ?? '');
  const shown = (await page.getByTestId('security-certificate-fingerprint').textContent())?.trim() ?? '';
  const expected = `${access.tls.fingerprintSha256.split(':').slice(0, 8).join(' ')} …`;
  record('Settings shows the certificate fingerprint', shown === expected, shown);
  await page.getByTestId('security-certificate').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'desktop-settings-security-lan.png') });

  if (lan) {
    const served = await peerFingerprint(lan, port);
    record('the LAN address answers HTTPS with the displayed certificate', served === access.tls.fingerprintSha256, served);
    const redirect = await fetch(`http://${lan}:${port}/`, { redirect: 'manual' });
    record('a browser page over plain HTTP on the LAN is redirected to https://', redirect.status === 308 && redirect.headers.get('location') === `https://${lan}:${port}/`, `${redirect.status} ${redirect.headers.get('location')}`);
  } else {
    record('a private LAN address is available for the HTTPS check', false, 'none found');
  }

  const health = await page.evaluate(async (o) => (await fetch(`${o}/api/health`)).status, origin);
  record('loopback API still works after the switch', health === 200, `status=${health}`);

  // ── Back to loopback only ──
  await page.getByTestId('security-network').getByRole('radio', { name: 'Loopback only' }).click();
  const offDeadline = Date.now() + 90_000;
  let off = null;
  while (Date.now() < offDeadline) {
    off = await page
      .evaluate(async (o) => {
        const r = await fetch(`${o}/api/security/network-access`);
        return r.ok ? r.json() : null;
      }, origin)
      .catch(() => null);
    if (off && !off.active) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  record('turning exposure off restarts loopback-only without TLS', Boolean(off && !off.active && off.tls === null), JSON.stringify({ active: off?.active, tls: off?.tls }));
} catch (err) {
  record('smoke ran to completion', false, err instanceof Error ? err.message : String(err));
}
await finish();

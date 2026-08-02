// ────────────────────────────────────────────────────────────────
// Desktop security smoke test.
//
//   node agent-tests/desktop-security-smoke.mjs
//
// Launches the real Electron shell in standalone mode (it spawns its own
// server) and proves the desktop-specific half of the auth architecture:
//
//   1. The shell unlocks an OS-protected vault key via `safeStorage` and
//      injects it, so the server reports a secure secret backend rather than
//      the mode-0600 file fallback.
//   2. The renderer enrols itself as an ordinary device over the loopback
//      handshake — the user never sees a pairing screen for the app that
//      started the server.
//   3. Once paired, the renderer's requests carry a DPoP proof and the app
//      renders normally.
//   4. No credential is reachable from the renderer's global scope, and the
//      device key is non-extractable.
//
// Not named *.spec.ts so the Playwright runner does not auto-run it.
// ────────────────────────────────────────────────────────────────

import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

const DESKTOP = path.resolve(process.cwd(), 'apps', 'desktop');
const requireFromDesktop = createRequire(path.join(DESKTOP, 'package.json'));
const ELECTRON = requireFromDesktop('electron');

let passed = 0;
let failed = 0;
const record = (name, ok, info = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ` :: ${info}` : ''}`);
};

const app = await electron.launch({
  executablePath: ELECTRON,
  args: ['.'],
  cwd: DESKTOP,
  env: { ...process.env, GENERATORAI_DESKTOP_MODE: 'standalone' },
  timeout: 90_000,
});

const mainLog = [];
app.process().stdout?.on('data', (d) => mainLog.push(d.toString()));
app.process().stderr?.on('data', (d) => mainLog.push(d.toString()));

async function finish() {
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  try {
    await app.close();
  } catch {
    /* already gone */
  }
  process.exit(failed === 0 ? 0 : 1);
}

// ── Wait for the renderer ──
let page = null;
const deadline = Date.now() + 120_000;
while (Date.now() < deadline && !page) {
  for (const w of app.windows()) {
    let url = '';
    try {
      url = w.url();
    } catch {
      /* transitioning */
    }
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      page = w;
      break;
    }
  }
  if (!page) await new Promise((r) => setTimeout(r, 800));
}

if (!page) {
  record('main window appears', false, 'no http window');
  await finish();
}
record('main window appears', true, page.url());
const origin = new URL(page.url()).origin;

await page.waitForLoadState('domcontentloaded').catch(() => {});
// Auto-pairing is a round trip through the shell, so give it room.
await page
  .waitForFunction(
    () => !document.body.innerText.includes('Pair this device') &&
      document.querySelector('#root')?.children.length > 0,
    { timeout: 60_000 },
  )
  .catch(() => {});
await page.waitForTimeout(2500);

// ── 1. The renderer paired itself; no pairing wall ──
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400));
record(
  'renderer auto-paired (no pairing screen)',
  !bodyText.includes('Pair this device'),
  bodyText.slice(0, 60).replace(/\n/g, ' '),
);

// ── 2. Authenticated API access works ──
const health = await page.evaluate(async (o) => {
  const r = await fetch(`${o}/api/health`);
  return { status: r.status, body: await r.text() };
}, origin);
record('GET /api/health succeeds', health.status === 200);

const posture = await page.evaluate(async (o) => {
  const r = await fetch(`${o}/api/security/posture`);
  return { status: r.status, body: r.ok ? await r.json() : null };
}, origin);
record('GET /api/security/posture is authorized', posture.status === 200, `status=${posture.status}`);

// ── 3. The shell supplied an OS-protected vault key ──
if (posture.body) {
  const kind = posture.body.secretStore?.kind ?? '';
  record(
    'secret backend is OS-protected (safeStorage-derived key)',
    posture.body.secretStore?.secure === true,
    kind,
  );
  record(
    'authentication is required',
    posture.body.authentication?.required === true,
  );
  record(
    'server is bound to loopback only',
    posture.body.server?.loopbackOnly === true,
    posture.body.server?.bindHost,
  );
}

// ── 4. Devices list shows the desktop renderer ──
const devices = await page.evaluate(async (o) => {
  const r = await fetch(`${o}/api/auth/devices`);
  return r.ok ? await r.json() : { devices: [], status: r.status };
}, origin);
record(
  'desktop renderer appears in the device registry',
  Array.isArray(devices.devices) && devices.devices.some((d) => d.platform === 'desktop'),
  `count=${devices.devices?.length ?? 0}`,
);
record(
  'device list never leaks key material',
  !JSON.stringify(devices).includes('publicJwk') &&
    !JSON.stringify(devices).includes('jwkThumbprint'),
);

// ── 5. Credential hygiene in the renderer ──
const leaks = await page.evaluate(() => {
  const ls = { ...localStorage };
  return {
    // The legacy shared key must not have been re-introduced.
    hasLegacyKey: Object.prototype.hasOwnProperty.call(ls, 'generatorai-api-key'),
    // No access token or resume secret in localStorage keys.
    suspicious: Object.keys(ls).filter((k) => /token|secret|password/i.test(k)),
    // The runtime must not be hanging off window for a page script to grab.
    globalRuntime: typeof window.__generatoraiAuth !== 'undefined',
  };
});
record('no legacy shared API key in localStorage', !leaks.hasLegacyKey);
record('no token/secret-named localStorage keys', leaks.suspicious.length === 0, leaks.suspicious.join(','));
record('auth runtime is not exposed on window', !leaks.globalRuntime);

const keyIsNonExtractable = await page.evaluate(async () => {
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('generatorai-auth');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!db.objectStoreNames.contains('keys')) return 'no key store';
    const pair = await new Promise((res, rej) => {
      // Must match `KEY_ID` in packages/client-runtime/src/browserStores.ts.
      const tx = db.transaction('keys', 'readonly').objectStore('keys').get('device-key');
      tx.onsuccess = () => res(tx.result);
      tx.onerror = () => rej(tx.error);
    });
    if (!pair?.privateKey) return 'no private key';
    // A non-extractable key throws on export. That is the whole point: XSS
    // can *use* the key while the page lives, but can never steal it.
    try {
      await crypto.subtle.exportKey('jwk', pair.privateKey);
      return 'EXTRACTABLE';
    } catch {
      return 'non-extractable';
    }
  } catch (e) {
    return `error: ${String(e).slice(0, 60)}`;
  }
});
record(
  'device private key is non-extractable',
  keyIsNonExtractable === 'non-extractable',
  keyIsNonExtractable,
);

// ── 6. Main-process logs must not carry credentials ──
const joined = mainLog.join('\n');
record(
  'main process log contains no vault key',
  !/GENERATORAI_SECRET_KEY=\S/.test(joined),
);
record(
  'main process log contains no pairing code',
  !joined.includes('generatorai://pair?code='),
);

await finish();

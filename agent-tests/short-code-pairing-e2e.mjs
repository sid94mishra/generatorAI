// Run: node --import tsx agent-tests/short-code-pairing-e2e.mjs
//
// Exercises the "second device on my network" flow the way a person does it:
//   1. the host mints a pairing code from Settings
//   2. a human reads a SHORT code off the screen and types it elsewhere
//   3. the joining device asks what the code grants (consent), then redeems it
//
// The point of the test is that step 2 involves no endpoint blob, no base64,
// and no copy-paste: only the origin the device already loaded and 12
// characters. It also pins the properties that make that safe to do.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3218;
const BASE = `http://127.0.0.1:${PORT}`;
const API_KEY = 'short-code-e2e-admin-key';

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` :: ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'generatorai-shortcode-'));
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    // The widget asset server binds its own port; keep it clear of the
    // default so this suite can run alongside a dev server.
    WIDGET_PORT: String(PORT + 1),
    DB_PATH: join(dataDir, 'test.db'),
    GENERATORAI_SECRETS_DIR: dataDir,
    GENERATORAI_API_KEY: API_KEY,
    // Authentication MUST be on: this test is about the pairing path.
    GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK: '0',
    GENERATORAI_BIND_HOST: '127.0.0.1',
    GENERATORAI_SECRET_KEY: Buffer.alloc(32, 9).toString('base64'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', (b) => (serverLog += b.toString()));
child.stderr.on('data', (b) => (serverLog += b.toString()));

async function waitForServer() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function adminHeaders() {
  return { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` };
}

try {
  if (!(await waitForServer())) {
    console.log(serverLog);
    throw new Error('server did not start');
  }

  console.log('\n  Short-code pairing (the "second laptop" flow)\n');

  // ── 1. Host mints a pairing code ──────────────────────────────
  const mintRes = await fetch(`${BASE}/api/auth/pair`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ deviceName: 'Second laptop', platform: 'web' }),
  });
  const mint = await mintRes.json();
  check('host mints a pairing code', mintRes.status === 201, `HTTP ${mintRes.status}`);

  const shortCode = mint.shortCode;
  check('response carries a short code', typeof shortCode === 'string', shortCode);
  check('code is short enough to read aloud', shortCode.length <= 16, `${shortCode.length} chars`);
  check(
    'code is grouped for readability',
    /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(shortCode),
    shortCode,
  );
  check(
    'code avoids the glyphs people mistype',
    !/[ILOU]/.test(shortCode),
    'no I, L, O or U',
  );
  check('response says where to type it', typeof mint.joinUrl === 'string', mint.joinUrl);

  // The old blob is still available for QR, but it is NOT what a human uses.
  check(
    'the QR payload remains available for scanning',
    typeof mint.pairingCode === 'string' && mint.pairingCode.length > 200,
    `${mint.pairingCode?.length} chars`,
  );

  // ── 2. Joining device previews the code (informed consent) ────
  // Note: NO credential is used here. This is a device that has nothing yet.
  const previewRes = await fetch(`${BASE}/api/auth/pair/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairingToken: shortCode }),
  });
  const preview = await previewRes.json();
  check('an unpaired device can preview the code', previewRes.status === 200, `HTTP ${previewRes.status}`);
  check('preview names the server', typeof preview.serverName === 'string', preview.serverName);
  check('preview pins the host identity', typeof preview.serverId === 'string', preview.serverId?.slice(0, 12));
  check(
    'preview states the exact authority being granted',
    Array.isArray(preview.requestedScopes) && preview.requestedScopes.length > 0,
    preview.requestedScopes?.join(', '),
  );
  check('preview leaks no grant id', preview.grantId === undefined);
  check('preview leaks no credential', !JSON.stringify(preview).includes('resume'));

  // ── 3. The dashes and case a human types are tolerated ────────
  const messyRes = await fetch(`${BASE}/api/auth/pair/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairingToken: `  ${shortCode.toLowerCase().replace(/-/g, ' ')}  ` }),
  });
  check(
    'a lowercase, space-separated retype still resolves',
    messyRes.status === 200,
    `HTTP ${messyRes.status}`,
  );

  // ── 4. Previewing does not consume the single-use grant ───────
  const stillPendingRes = await fetch(`${BASE}/api/auth/pair/pending`, { headers: adminHeaders() });
  const stillPending = await stillPendingRes.json();
  check(
    'preview does not consume the grant',
    stillPending.pending?.some((p) => p.grantId === mint.grantId),
  );
  check(
    'preview does not burn a redemption attempt',
    stillPending.pending?.find((p) => p.grantId === mint.grantId)?.attempts === 0,
  );

  // ── 5. A wrong code is rejected indistinguishably ─────────────
  const wrongRes = await fetch(`${BASE}/api/auth/pair/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairingToken: '2345-6789-ABCD' }),
  });
  const wrong = await wrongRes.json();
  check('an unknown code is rejected', wrongRes.status >= 400, `HTTP ${wrongRes.status}`);
  check(
    'rejection does not reveal whether the code ever existed',
    wrong.error?.code === 'INVALID_GRANT',
    wrong.error?.code,
  );

  // ── 6. The short code actually redeems ────────────────────────
  const { AuthenticatedClientRuntime, MemoryDeviceKeyStore, MemorySessionStore } = await import(
    '../packages/client-runtime/src/index.ts'
  );
  const runtime = new AuthenticatedClientRuntime({
    endpoint: BASE,
    keyStore: new MemoryDeviceKeyStore(),
    sessionStore: new MemorySessionStore(),
  });
  const session = await runtime.completePairing({
    endpoint: BASE,
    serverId: preview.serverId,
    // Exactly what the user typed — not a decoded offer.
    pairingToken: shortCode,
    deviceName: 'Second laptop',
    platform: 'web',
    connectionMode: 'auto',
  });
  check('the typed short code pairs the device', Boolean(session?.deviceId), session?.deviceId);

  const meRes = await runtime.fetch('/api/auth/server-info');
  check('the paired device can call the API', meRes.ok, `HTTP ${meRes.status}`);

  // ── 7. Single use is still enforced ───────────────────────────
  const replayRes = await fetch(`${BASE}/api/auth/pair/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairingToken: shortCode }),
  });
  check('a consumed code stops working', replayRes.status >= 400, `HTTP ${replayRes.status}`);

  // ── 8. Nothing secret reached the logs ────────────────────────
  check('the short code never appears in server logs', !serverLog.includes(shortCode.replace(/-/g, '')));
} catch (err) {
  failed += 1;
  console.log(`  FAIL  harness error :: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  for (let i = 0; i < 5; i += 1) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

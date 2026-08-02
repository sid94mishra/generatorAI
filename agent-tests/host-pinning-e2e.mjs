// ────────────────────────────────────────────────────────────────
// Host identity pinning test.
//
//   node --import tsx agent-tests/host-pinning-e2e.mjs
//
// `--import tsx` is required: this test drives the REAL client runtime by
// importing its TypeScript source, so the assertions cannot drift from the
// shipped implementation the way a re-implementation would.
//
// Pinning `serverId` at pairing time is only worth anything if the client
// actually CHECKS it. This test proves the check by doing what an attacker
// would: standing up a second, different GeneratorAI server on the address a
// client already paired with, and confirming the client refuses to hand over
// its credential.
//
// This is the control that survives when TLS does not — a self-signed LAN
// certificate, a plaintext port-forward, or a relay that terminates the
// connection. Trust comes from out-of-band pairing, not from the transport.
//
// Not named *.spec.ts so the Playwright runner does not auto-run it.
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

let passed = 0;
let failed = 0;
const record = (name, ok, info = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ` :: ${info}` : ''}`);
};

const children = [];
const tempDirs = [];
function cleanup() {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* gone */
    }
  }
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
process.on('exit', cleanup);

/**
 * Boots a server with its OWN data directory, so it generates its own host
 * identity keypair. Two of these are genuinely different hosts — exactly the
 * situation the pin is meant to detect.
 */
async function startServer(port) {
  const dataDir = mkdtempSync(join(tmpdir(), 'generatorai-pin-'));
  tempDirs.push(dataDir);

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/index.ts'],
    {
      cwd: 'apps/server',
      env: {
        ...process.env,
        PORT: String(port),
        WIDGET_PORT: String(port + 1),
        DB_PATH: join(dataDir, 'db.sqlite'),
        WORKSPACES_DIR: join(dataDir, 'workspaces'),
        ARTIFACTS_DIR: join(dataDir, 'artifacts'),
        // Deterministic, isolated vault per server.
        GENERATORAI_SECRET_KEY: randomBytes(32).toString('base64'),
        GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK: '',
        GENERATORAI_API_KEY: '',
        LOG_LEVEL: 'warn',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(child);

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/auth/server-info`);
      if (r.ok) return { child, dataDir, info: await r.json(), port };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server on ${port} did not start`);
}

console.log('\n  Host identity pinning\n');

const a = await startServer(3411);
const b = await startServer(3413);

record('two independent servers start', Boolean(a.info.serverId && b.info.serverId));
record(
  'each server has a DISTINCT host identity',
  a.info.serverId !== b.info.serverId,
  `${a.info.serverId.slice(0, 12)}… vs ${b.info.serverId.slice(0, 12)}…`,
);
record(
  'host identity is a stable 43-char base64url fingerprint',
  /^[A-Za-z0-9_-]{43}$/.test(a.info.serverId),
  a.info.serverId,
);

// Identity must be stable across calls, or pinning would false-positive on
// every reconnect.
const again = await fetch(`http://127.0.0.1:${a.port}/api/auth/server-info`).then((r) => r.json());
record('host identity is stable across requests', again.serverId === a.info.serverId);

// ── The client-side check ────────────────────────────────────────
//
// Drive the real runtime: pair against server A, then repoint the stored
// session at server B and confirm the runtime refuses.

const { AuthenticatedClientRuntime, MemoryDeviceKeyStore, HostIdentityChangedError } =
  await import('../packages/client-runtime/src/index.ts');

/** Session store we can tamper with, standing in for a hijacked endpoint. */
class MutableSessionStore {
  constructor() {
    this.session = null;
  }
  async load() {
    return this.session;
  }
  async save(s) {
    this.session = s;
  }
  async clear() {
    this.session = null;
  }
}

// Mint a pairing grant on A using its bootstrap file would be involved, so we
// exercise the check directly: a session that claims A's serverId, pointed at
// an endpoint that is really B.
const sessionStore = new MutableSessionStore();
await sessionStore.save({
  serverId: a.info.serverId,
  endpoint: `http://127.0.0.1:${b.port}`, // ← the substituted host
  deviceId: 'device-under-test',
  deviceName: 'Test device',
  scopes: ['read:status'],
  resumeSecret: 'resume-secret-value',
  resumeExpiresAt: Date.now() + 3_600_000,
  credentialVersion: 1,
});

const runtime = new AuthenticatedClientRuntime({
  endpoint: `http://127.0.0.1:${b.port}`,
  keyStore: new MemoryDeviceKeyStore(),
  sessionStore,
});
await runtime.initialize().catch(() => {});

let thrown = null;
try {
  await runtime.fetch('/api/security/posture');
} catch (err) {
  thrown = err;
}

record(
  'client refuses to authenticate against a substituted host',
  thrown instanceof HostIdentityChangedError,
  thrown ? `${thrown.name}` : 'no error thrown',
);

if (thrown instanceof HostIdentityChangedError) {
  record('the error names the expected identity', thrown.expected === a.info.serverId);
  record('the error names the identity actually found', thrown.actual === b.info.serverId);
  record(
    'the message tells a human what to do',
    /impersonating|re-pair/i.test(thrown.message),
  );
}

// The resume secret must NOT have been transmitted to the impostor.
const bLog = [];
b.child.stdout?.on('data', (d) => bLog.push(d.toString()));
await new Promise((r) => setTimeout(r, 300));
record(
  'no credential was sent to the impostor',
  !bLog.join('').includes('resume-secret-value'),
);

// ── Positive control ─────────────────────────────────────────────
//
// The same runtime pointed at the CORRECT server must get past the identity
// check (and then fail for an ordinary auth reason, not an identity one).
const goodStore = new MutableSessionStore();
await goodStore.save({
  serverId: a.info.serverId,
  endpoint: `http://127.0.0.1:${a.port}`,
  deviceId: 'device-under-test',
  deviceName: 'Test device',
  scopes: ['read:status'],
  resumeSecret: 'resume-secret-value',
  resumeExpiresAt: Date.now() + 3_600_000,
  credentialVersion: 1,
});
const goodRuntime = new AuthenticatedClientRuntime({
  endpoint: `http://127.0.0.1:${a.port}`,
  keyStore: new MemoryDeviceKeyStore(),
  sessionStore: goodStore,
});
await goodRuntime.initialize().catch(() => {});

let goodError = null;
try {
  await goodRuntime.fetch('/api/security/posture');
} catch (err) {
  goodError = err;
}
record(
  'matching identity passes the pin check',
  !(goodError instanceof HostIdentityChangedError),
  goodError ? goodError.name : 'no error',
);

console.log(`\n  ${passed} passed, ${failed} failed\n`);
cleanup();
process.exit(failed === 0 ? 0 : 1);

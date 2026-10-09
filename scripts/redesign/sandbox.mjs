#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// P2-00 — the redesign sandbox (09-verification.md §6.2): a deterministic,
// seeded, isolated stack for walkthroughs and destructive testing that never
// touches :3100/:5173 or the developer's real database.
//
//   node scripts/redesign/sandbox.mjs                 → Faux harness (default)
//   node scripts/redesign/sandbox.mjs --port=3297 --web-port=5297 → second isolated sandbox
//   node scripts/redesign/sandbox.mjs --real-harness   → real provider CLIs
//   node scripts/redesign/sandbox.mjs --lan            → Network exposure + built-in HTTPS for native devices (MV-44)
//   node scripts/redesign/sandbox.mjs --clean          → remove old sandbox temp dirs, then exit
//   node scripts/redesign/sandbox.mjs --help           → resolve and print the commands, start nothing
//   node scripts/redesign/sandbox.mjs --dry-run         → same as --help (alias)
//
// What it does, in order:
//   1. Bundles the server if apps/server/dist-bundle is missing.
//   2. Starts the server on :3197 with a temp DB under
//      os.tmpdir()/generatorai-sandbox-* (bare env names — D-44), loopback
//      dev-auth, and (by default) the Faux harness scripted from
//      agent-tests/vrt/fixtures/sandbox.faux.json merged with the e2e
//      fixtures (agent-tests/e2e/fixtures/faux-*.json — lib/sandbox-faux.mjs).
//   3. Asserts the startup log's dbPath is the temp one before continuing.
//   4. Runs agent-tests/vrt/seed.ts against it.
//   5. Starts Vite on :5197, proxying /api to :3197 (GENERATORAI_DEV_API_TARGET
//      — see apps/web/vite.config.ts).
//   6. Prints the sandbox URL.
//
// Ctrl-C / SIGTERM stops both children cleanly on every OS: the server gets
// the same `{ type: 'shutdown' }` IPC message the desktop app's production
// shutdown path uses (apps/server/src/index.ts — Windows maps a raw
// kill('SIGTERM') to TerminateProcess, which no handler can observe), and
// both children are spawned with an 'ipc' stdio slot even where a signal IS
// used (Vite), because — per agent-tests/concurrent-load-1q.mjs — an IPC
// channel being PRESENT is what makes Node relay a signal to the child's own
// handler on Windows in the first place, instead of hard-killing it. A
// SIGKILL fallback covers a child that doesn't exit within the budget.
// ────────────────────────────────────────────────────────────────

import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { nodeBinArgs, pnpmCommand } from './lib/spawn-node-bin.mjs';
import { sandboxOptions, sandboxCorsOrigins } from './lib/sandbox-options.mjs';
import { prepareSandboxFauxScript } from './lib/sandbox-faux.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SERVER_DIR = path.join(ROOT, 'apps', 'server');
const WEB_DIR = path.join(ROOT, 'apps', 'web');
// GENERATORAI_SANDBOX_BUNDLE — run another bundle of the server (absolute, or
// relative to the repo root). Staging the desktop runtime
// (apps/desktop/scripts/stage-server-runtime.mjs) installs Electron-ABI native
// addons into dist-bundle/node_modules, which system Node cannot load; a bundle
// one level under apps/server/ with no node_modules beside it resolves the
// workspace's Node-ABI copies instead and keeps every path the server derives
// from its own location (templates/, agent-host, pty-host, web/dist) intact.
const BUNDLE_ENTRY = process.env.GENERATORAI_SANDBOX_BUNDLE
  ? path.resolve(ROOT, process.env.GENERATORAI_SANDBOX_BUNDLE)
  : path.join(SERVER_DIR, 'dist-bundle', 'server.mjs');
const SEED_SCRIPT = path.join(ROOT, 'agent-tests', 'vrt', 'seed.ts');

// Not `gai-`/`genai-` — those prefixes are what scripts/sweep-temp-workspaces.mjs deletes.
const PREFIX = 'generatorai-sandbox-';
const { serverPort: SERVER_PORT, webPort: WEB_PORT } = sandboxOptions();
const CORS_ORIGINS = sandboxCorsOrigins(WEB_PORT);
const SHUTDOWN_BUDGET_MS = 5_000;
const START_TIMEOUT_MS = 60_000;

function log(msg) {
  console.log(`[sandbox] ${msg}`);
}

// P2-R22(b) — `serverLog`/`viteLog` exist only so a startup failure can print
// recent output; kept as an unbounded `+=` they grew for the whole life of a
// long-running sandbox. Bounded ring: keep only the tail, in characters
// (an approximation of bytes good enough for a debug log).
const LOG_RING_MAX_CHARS = 200 * 1024;
function appendToRing(current, chunk) {
  const next = current + chunk;
  return next.length > LOG_RING_MAX_CHARS ? next.slice(next.length - LOG_RING_MAX_CHARS) : next;
}

// ── --help / --dry-run ──────────────────────────────────────────
//
// P2-R10 — resolves every command this script would spawn (pnpm bundle
// fallback, tsx for the seed, vite for the web server) through the shared
// helper and prints them, WITHOUT starting any server or Vite. Lets a
// developer or CI confirm the spawn helper resolves real, existing files on
// this OS without touching :3197/:5197.

function printResolvedCommands() {
  const pnpmBundle = pnpmCommand(['--filter', '@generatorai/server', 'bundle']);
  const pnpmBundleArgs = pnpmBundle.args.length > 0 ? ` ${pnpmBundle.args.join(' ')}` : '';
  console.log('[sandbox] resolved commands (nothing started):');
  console.log(`  ports: API ${SERVER_PORT}, widget ${SERVER_PORT + 1}, web ${WEB_PORT}`);
  console.log(`  pnpm (bundle fallback): ${pnpmBundle.command}${pnpmBundleArgs}${pnpmBundle.options.shell ? '  (shell: true)' : ''}`);
  try {
    const tsx = nodeBinArgs(SERVER_DIR, 'tsx', 'tsx', [SEED_SCRIPT]);
    console.log(`  seed (tsx):             ${tsx.command} ${tsx.args.join(' ')}`);
  } catch (err) {
    console.log(`  seed (tsx):             could not resolve — ${err.message}`);
  }
  try {
    const vite = nodeBinArgs(WEB_DIR, 'vite', 'vite', ['--port', String(WEB_PORT), '--host', '127.0.0.1', '--strictPort']);
    console.log(`  web (vite):             ${vite.command} ${vite.args.join(' ')}`);
  } catch (err) {
    console.log(`  web (vite):             could not resolve — ${err.message}`);
  }
}

if (process.argv.includes('--help') || process.argv.includes('--dry-run')) {
  printResolvedCommands();
  process.exit(0);
}

// ── --clean ──────────────────────────────────────────────────────

// P2-R44 — the Electron smokes' isolated profile directories
// (agent-tests/helpers/desktop-profile.mjs's `isolatedProfile()`) leak on
// Windows when a SIGINT/SIGTERM lands mid-run (no OS temp sweep there), and
// `--clean` is the one cleanup command most people actually remember to run.
// Sweep those alongside this script's own sandbox dirs. Matches the prefixes
// isolatedProfile()'s call sites actually pass: `gai-desktop-smoke-`,
// `gai-security-smoke-`, `gai-chrome-smoke-`, `gai-packaged-smoke-`,
// `gai-pairing-diag-` (agent-tests/desktop-smoke.mjs,
// desktop-security-smoke.mjs, desktop-chrome-smoke.mjs, packaged-app-smoke.mjs,
// desktop-pairing-diagnostic.mjs). scripts/sweep-temp-workspaces.mjs already
// sweeps every `gai-*`/`genai-*` prefix on a schedule/age basis; this is the
// immediate, on-demand counterpart for someone who only knows `--clean`.
const DESKTOP_PROFILE_PATTERN = /^gai-(desktop-smoke|security-smoke|chrome-smoke|packaged-smoke|pairing-diag)-/;

/** The sandbox that owns a temp dir writes its pid there; `--clean` leaves a live one alone. */
const PID_FILE = 'sandbox.pid';

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else — still alive.
    return err?.code === 'EPERM';
  }
}

function clean() {
  const tmp = os.tmpdir();
  let removed = 0;
  let kept = 0;
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith(PREFIX) && !DESKTOP_PROFILE_PATTERN.test(name)) continue;
    // Several sandboxes run side by side (parallel sessions, other worktrees):
    // deleting a running one's DB and workspaces out from under it breaks it.
    let pid = 0;
    try {
      pid = Number.parseInt(fs.readFileSync(path.join(tmp, name, PID_FILE), 'utf8'), 10) || 0;
    } catch {
      /* no pid file: a desktop profile or a sandbox from before this guard */
    }
    if (pid > 0 && pid !== process.pid && isAlive(pid)) {
      kept += 1;
      continue;
    }
    fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    removed += 1;
  }
  log(`removed ${removed} sandbox/desktop-smoke temp dir(s) from ${tmp}${kept ? `; kept ${kept} in use` : ''}`);
}

if (process.argv.includes('--clean')) {
  clean();
  process.exit(0);
}

const realHarness = process.argv.includes('--real-harness');
// --lan (mobile MV-44, D-127): bound to 0.0.0.0 with the built-in HTTPS, so a simulator, emulator or phone reaches
// the sandbox at https://<LAN address>:<port> and pins the CA from the pairing offer. Network exposure forbids
// unauthenticated loopback, so the server gets a throwaway vault key and an admin API key
// (GENERATORAI_SANDBOX_API_KEY, else random) that the seed — and the mobile tooling — send as a bearer token.
// The Vite UI cannot sign in on this sandbox; it is for native devices.
const lan = process.argv.includes('--lan');
const lanApiKey = lan ? (process.env.GENERATORAI_SANDBOX_API_KEY || randomBytes(24).toString('base64url')) : null;

// Declared up front (not near the shutdown handlers below) so every exit
// listener registered on a child — including the ones from an early failure
// path (dbPath assertion, seed failure) that stops a child before reaching
// the bottom of this file — can read it safely.
let shuttingDown = false;
// Queue an early supervisor shutdown until both child handles exist.
let ipcShutdownReady = false;
let ipcShutdownRequested = false;
process.on('message', (message) => {
  if (message?.type !== 'shutdown') return;
  if (ipcShutdownReady) void shutdown('IPC');
  else ipcShutdownRequested = true;
});

// ── 1. Bundle the server if missing ─────────────────────────────

if (!fs.existsSync(BUNDLE_ENTRY)) {
  log('dist-bundle missing — bundling the server (pnpm --filter @generatorai/server bundle)...');
  // P2-R10 — never spawn a `pnpm.cmd` shim directly (EINVAL on Node
  // >=18.20.2/20.12.2/22, CVE-2024-27980); see lib/spawn-node-bin.mjs.
  const pnpm = pnpmCommand(['--filter', '@generatorai/server', 'bundle']);
  execFileSync(pnpm.command, pnpm.args, { cwd: ROOT, stdio: 'inherit', ...pnpm.options });
}

// ── 2. Temp DB / artifacts / workspaces / extensions dirs ──────

const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
fs.writeFileSync(path.join(sandboxDir, PID_FILE), String(process.pid));
const dbPath = path.join(sandboxDir, 'sandbox.db');
const artifactsDir = path.join(sandboxDir, 'artifacts');
const workspacesDir = path.join(sandboxDir, 'workspaces');
const extensionsDir = path.join(sandboxDir, 'extensions');
for (const dir of [artifactsDir, workspacesDir, extensionsDir]) fs.mkdirSync(dir, { recursive: true });
log(`temp dir: ${sandboxDir}`);

// The Faux script: the sandbox fixture merged with the e2e fixtures, so the
// whole e2e suite runs on a plain sandbox (lib/sandbox-faux.mjs).
const fauxScript = realHarness ? null : prepareSandboxFauxScript(ROOT, sandboxDir);
if (fauxScript) {
  log(
    fauxScript.sources.length > 0
      ? `Faux script: ${fauxScript.sources.map((f) => path.relative(ROOT, f)).join(' + ')}`
      : `Faux script: ${fauxScript.file}`,
  );
}

// ── 3. Start the server ─────────────────────────────────────────

const serverEnv = {
  ...process.env,
  PORT: String(SERVER_PORT),
  WIDGET_PORT: String(SERVER_PORT + 1),
  // D-44 — bare names; GENERATORAI_-prefixed equivalents are silently ignored
  // and would open the developer's real database.
  DB_PATH: dbPath,
  ARTIFACTS_DIR: artifactsDir,
  WORKSPACES_DIR: workspacesDir,
  EXTENSIONS_DIR: extensionsDir,
  ...(lan
    ? {
        GENERATORAI_BIND_HOST: '0.0.0.0',
        GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK: '0',
        GENERATORAI_SECRETS_DIR: sandboxDir,
        GENERATORAI_SECRET_KEY: randomBytes(32).toString('base64'),
        GENERATORAI_API_KEY: lanApiKey,
        // The seed publishes a workflow; the admin key is not a person (PD-14), so let it publish in this sandbox.
        GENERATORAI_ALLOW_AGENT_PUBLISH: 'true',
      }
    : { GENERATORAI_BIND_HOST: '127.0.0.1', GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK: '1' }),
  NODE_ENV: 'test',
  CORS_ORIGINS,
  ...(realHarness
    ? {}
    : {
        GENERATORAI_TEST_FAUX_HARNESS: 'true',
        GENERATORAI_TEST_FAUX_SCRIPT: fauxScript.file,
      }),
};

log(`starting server on :${SERVER_PORT} (${realHarness ? 'real harness' : 'Faux harness'})...`);
const serverChild = spawn(process.execPath, [BUNDLE_ENTRY], {
  cwd: SERVER_DIR,
  env: serverEnv,
  // The 4th ('ipc') slot: lets us `send({type:'shutdown'})` for graceful
  // stop, AND (Windows) is what makes a later kill('SIGTERM') reach the
  // child's own signal handler instead of a hard TerminateProcess. See the
  // file header and agent-tests/concurrent-load-1q.mjs.
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
let serverLog = '';
serverChild.stdout.on('data', (c) => { serverLog = appendToRing(serverLog, c.toString()); process.stdout.write(`[server] ${c}`); });
serverChild.stderr.on('data', (c) => { serverLog = appendToRing(serverLog, c.toString()); process.stderr.write(`[server] ${c}`); });
serverChild.on('exit', (code, signal) => {
  if (!shuttingDown) {
    console.error(`[sandbox] server exited unexpectedly (code=${code} signal=${signal})`);
    console.error(serverLog.slice(-4000));
    process.exit(1);
  }
});

async function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await delay(300);
  }
  throw new Error(`${url} did not become healthy within ${timeoutMs}ms`);
}

await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/api/health`, START_TIMEOUT_MS);

// D-44 — assert the startup log really is on the temp DB before doing
// anything else. The pino line is JSON: {"…","dbPath":"<path>",…}.
const expectedDbPathJson = `"dbPath":${JSON.stringify(dbPath)}`;
{
  const deadline = Date.now() + 15_000;
  let onTempDb = serverLog.includes(expectedDbPathJson);
  while (!onTempDb && Date.now() < deadline) {
    await delay(300);
    onTempDb = serverLog.includes(expectedDbPathJson);
  }
  if (!onTempDb) {
    console.error(`[sandbox] server did not report the temp dbPath (expected ${expectedDbPathJson})`);
    console.error(serverLog.slice(-4000));
    await stopChild(serverChild, { ipcShutdown: true });
    process.exit(1);
  }
}
log(`server is on the temp DB: ${dbPath}`);

// ── 4. Seed ──────────────────────────────────────────────────────

log('seeding...');
try {
  // P2-R10 — tsx is apps/server's devDependency; resolve its JS entry point
  // from there and run it with process.execPath, never node_modules/.bin's
  // `.cmd` shim (see lib/spawn-node-bin.mjs).
  const tsx = nodeBinArgs(SERVER_DIR, 'tsx', 'tsx', [SEED_SCRIPT]);
  execFileSync(tsx.command, tsx.args, {
    cwd: ROOT,
    env: { ...process.env, API_URL: `http://127.0.0.1:${SERVER_PORT}/api`, ...(lanApiKey ? { API_KEY: lanApiKey } : {}) },
    stdio: 'inherit',
  });
} catch (err) {
  console.error('[sandbox] seed failed:', err.message);
  await stopChild(serverChild, { ipcShutdown: true });
  process.exit(1);
}

// ── 5. Start Vite ────────────────────────────────────────────────

log(`starting Vite on :${WEB_PORT}, proxying /api to :${SERVER_PORT}...`);
const viteEnv = {
  ...process.env,
  // apps/web/vite.config.ts — where /api is proxied in dev.
  GENERATORAI_DEV_API_TARGET: `http://localhost:${SERVER_PORT}`,
};
// P2-R10 — vite is apps/web's devDependency; resolve its JS entry point
// (vite/bin/vite.js) from there and run it with process.execPath — never
// node_modules/.bin's `.cmd` shim (see lib/spawn-node-bin.mjs). The child is
// then plain node running vite.js, with no cmd.exe wrapper hiding the real
// process, so the SIGTERM/SIGKILL path below reaches it directly.
const vite = nodeBinArgs(WEB_DIR, 'vite', 'vite', ['--port', String(WEB_PORT), '--host', '127.0.0.1', '--strictPort']);
const viteChild = spawn(vite.command, vite.args, {
  cwd: WEB_DIR,
  env: viteEnv,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
let viteLog = '';
viteChild.stdout.on('data', (c) => { viteLog = appendToRing(viteLog, c.toString()); process.stdout.write(`[web] ${c}`); });
viteChild.stderr.on('data', (c) => { viteLog = appendToRing(viteLog, c.toString()); process.stderr.write(`[web] ${c}`); });
viteChild.on('exit', (code, signal) => {
  if (!shuttingDown) {
    console.error(`[sandbox] vite exited unexpectedly (code=${code} signal=${signal})`);
    console.error(viteLog.slice(-4000));
    process.exit(1);
  }
});

await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`, START_TIMEOUT_MS);

console.log('');
console.log(`  Sandbox ready:  http://localhost:${WEB_PORT}`);
console.log(`  API:            http://localhost:${SERVER_PORT}/api`);
if (lan) console.log(`  LAN:            https://<this machine's LAN address>:${SERVER_PORT} (admin: Bearer GENERATORAI_SANDBOX_API_KEY)`);
console.log(`  DB:             ${dbPath}`);
console.log('  Ctrl-C to stop both processes cleanly.');
console.log('');

// ── 6. Clean shutdown on every OS ───────────────────────────────

async function stopChild(child, { ipcShutdown = false } = {}) {
  // P2-R22(a) — `child.killed` means "kill() was called on this child",
  // NOT "the child has exited": Node sets it synchronously inside kill(),
  // before the process has actually gone away. `exitCode`/`signalCode` are
  // both null until the 'exit' event fires, on every OS, regardless of
  // whether a signal was already sent — that's the correct "still alive"
  // check, both here and below for the SIGKILL fallback.
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));

  if (ipcShutdown && typeof child.send === 'function') {
    try { child.send({ type: 'shutdown' }); } catch { /* channel already gone — fall through to signal */ }
  } else {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }

  const timedOut = await Promise.race([
    exited.then(() => false),
    delay(SHUTDOWN_BUDGET_MS).then(() => true),
  ]);
  if (timedOut && child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    await Promise.race([exited, delay(2_000)]);
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[sandbox] ${signal} received — stopping server and web...`);
  await Promise.all([
    stopChild(serverChild, { ipcShutdown: true }),
    stopChild(viteChild, {}),
  ]);
  log('stopped.');
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
// Mobile's supervisor uses IPC so Windows also shuts down both children.
ipcShutdownReady = true;
if (ipcShutdownRequested) void shutdown('IPC');

// Keep the process alive until a signal arrives.
await new Promise(() => {});

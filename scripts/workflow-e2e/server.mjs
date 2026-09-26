#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Isolated E2E server for the workflow overhaul (P00 WP-0.3).
//
//   node scripts/workflow-e2e/server.mjs start [--provider claude-agent|faux] [--fresh]
//   node scripts/workflow-e2e/server.mjs stop
//   node scripts/workflow-e2e/server.mjs status
//
// Starts apps/server from source (tsx) with every path isolated under
// C:/gaiwf/ — PORT 3111, DB_PATH C:/gaiwf/data/data.db, WORKSPACES_DIR
// C:/gaiwf/ws, ARTIFACTS_DIR C:/gaiwf/art, loopback bind — waits for
// /api/health, and records its PID and OS creation time in
// C:/gaiwf/e2e-server.pid. `stop` kills ONLY that process tree, and only
// when all of these hold (`verifyOwnServer`): the process runs THIS
// worktree's tsx CLI on src/index.ts, its creation time matches the record
// (so a recycled pid is never killed), and it or a child owns the E2E port's
// listener. It refuses E2E_PORT=3100 and never touches the real DB.
//
// Provider: `claude-agent` (default) sets HARNESS_TYPE=claude-agent and uses
// the machine's Claude login. `faux` sets GENERATORAI_LOAD_TEST_FAUX_HARNESS
// (the server has no `HARNESS_TYPE=faux`; the load-test escape hatch routes
// EVERY conversation to FauxProvider, which answers instantly and empty).
// GENERATORAI_SECRET_KEY is removed from the child env: on loopback none is
// needed, and the isolated vault must not share the developer's key.
// ────────────────────────────────────────────────────────────────

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './lib/db.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The developer server's port. The E2E harness never talks to it. */
export const DEV_PORT = 3100;
export const E2E_ROOT = process.env.E2E_ROOT ?? 'C:/gaiwf';
export const PORT = Number(process.env.E2E_PORT ?? 3111);
if (PORT === DEV_PORT) throw new Error(`E2E_PORT=${DEV_PORT} is the developer server's port; the E2E harness refuses it`);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
/** The tsx CLI of THIS worktree: its path is in the E2E server's command line and nobody else's. */
const TSX_CLI = path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');
export const DATA_DIR = path.join(E2E_ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'data.db');
const PID_FILE = path.join(E2E_ROOT, 'e2e-server.pid');
const LOG_FILE = path.join(E2E_ROOT, 'e2e-server.log');

function isListening(port) {
  return new Promise((resolve) => {
    const s = connect({ port, host: '127.0.0.1' });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(1000, () => done(true)); // a hung listener still owns the port
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

function readPidFile() {
  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf8'));
  } catch {
    return null;
  }
}

const ps = (script) => execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();

/**
 * Command line and creation time of a live process, or null when it is
 * gone. The creation time is what makes a stale pid file safe: a recycled
 * pid belongs to a process created at a different moment.
 */
export function processInfo(pid) {
  try {
    if (process.platform === 'win32') {
      const out = ps(
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; ` +
          `if ($p) { @{ cmd = $p.CommandLine; created = $p.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }`,
      );
      return out ? JSON.parse(out) : null;
    }
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
    const created = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ')[19] ?? '';
    return { cmd, created };
  } catch {
    return null;
  }
}

/** PIDs listening on a TCP port (Windows: Get-NetTCPConnection; elsewhere: none known). */
function listenerPids(port) {
  if (process.platform !== 'win32') return [];
  try {
    const out = ps(`(Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue).OwningProcess`);
    return out ? out.split(/\r?\n/).map((l) => Number(l.trim())).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** A pid and every descendant (tsx runs the server in a child process). */
function processTree(pid) {
  if (process.platform !== 'win32') return new Set([pid]);
  try {
    const all = JSON.parse(ps(`Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress`));
    const kids = new Map();
    for (const p of all) kids.set(p.ParentProcessId, [...(kids.get(p.ParentProcessId) ?? []), p.ProcessId]);
    const tree = new Set([pid]);
    const walk = (p) => {
      for (const c of kids.get(p) ?? []) if (!tree.has(c)) (tree.add(c), walk(c));
    };
    walk(pid);
    return tree;
  } catch {
    return new Set([pid]);
  }
}

const sameFile = (a, b) => path.resolve(a).toLowerCase().replace(/\\/g, '/') === path.resolve(b).toLowerCase().replace(/\\/g, '/');

/**
 * Is `pf` (a pid file record) THIS harness's server? All must hold: the
 * process runs this worktree's tsx CLI, was created when the record says,
 * and — when the port is listening — owns the listener (itself or a child).
 */
export function verifyOwnServer(pf, info = processInfo(pf.pid), listeners = listenerPids(pf.port ?? PORT)) {
  if (!info) return { ok: false, reason: 'not running' };
  const cmd = String(info.cmd ?? '');
  const tsxInCmd = cmd
    .split(/["\s]+/)
    .some((tok) => tok && tok.toLowerCase().endsWith('cli.mjs') && sameFile(tok, TSX_CLI));
  if (!tsxInCmd || !/src[\\/]index\.ts/.test(cmd)) return { ok: false, reason: `not this worktree's E2E server (${cmd.slice(0, 100)})` };
  if (pf.created && info.created && pf.created !== info.created) {
    return { ok: false, reason: `pid ${pf.pid} was reused (created ${info.created}, recorded ${pf.created})` };
  }
  if (listeners.length > 0) {
    const tree = processTree(pf.pid);
    if (!listeners.some((l) => tree.has(l))) return { ok: false, reason: `port ${pf.port ?? PORT} is owned by another process (${listeners.join(', ')})` };
  }
  return { ok: true };
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE_URL}/api/health`);
      if (r.ok) return await r.json().catch(() => ({}));
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = String(e?.cause?.code ?? e);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server did not become healthy on ${BASE_URL} within ${timeoutMs} ms (last: ${last}); see ${LOG_FILE}`);
}

/** The engine's single-engine lock is stale after this long without a heartbeat (RunSupervisor, RV-27). */
const ENGINE_LOCK_STALE_MS = 30_000;

/**
 * A server killed moments ago (`stop` uses taskkill /F) leaves a fresh
 * `engine_lock` heartbeat behind, and a server booted before it goes stale
 * starts WITHOUT the workflow engine (invocations answer 503
 * ENGINE_UNAVAILABLE). Wait until the lock is stale before booting.
 */
async function waitForStaleEngineLock(log) {
  if (!existsSync(DB_PATH)) return;
  let heartbeatAt = null;
  const db = openDb(DB_PATH);
  try {
    heartbeatAt = db.prepare('SELECT heartbeat_at AS h FROM engine_lock LIMIT 1').get()?.h ?? null;
  } catch {
    return; // an older schema without the lock
  } finally {
    db.close();
  }
  const waitMs = heartbeatAt === null ? 0 : Number(heartbeatAt) + ENGINE_LOCK_STALE_MS + 1000 - Date.now();
  if (waitMs <= 0) return;
  log(`[e2e-server] waiting ${Math.ceil(waitMs / 1000)} s for the previous server's engine lock to go stale`);
  await new Promise((r) => setTimeout(r, waitMs));
}

export async function startServer({ provider = 'claude-agent', fresh = false, timeoutMs = 180_000, log = console.log } = {}) {
  if (await isListening(PORT)) {
    const pf = readPidFile();
    throw new Error(
      `port ${PORT} is already in use${pf ? ` (pid file says ${pf.pid})` : ''}; stop it first with \`server.mjs stop\``,
    );
  }
  if (fresh) {
    // Only the E2E server's own directories under E2E_ROOT.
    for (const d of ['data', 'ws', 'art']) rmSync(path.join(E2E_ROOT, d), { recursive: true, force: true });
  }
  for (const d of ['data', 'ws', 'art', 'creds']) mkdirSync(path.join(E2E_ROOT, d), { recursive: true });
  await waitForStaleEngineLock(log);

  const env = { ...process.env };
  delete env.GENERATORAI_SECRET_KEY;
  delete env.HARNESS_TYPE;
  delete env.GENERATORAI_LOAD_TEST_FAUX_HARNESS;
  Object.assign(env, {
    PORT: String(PORT),
    WIDGET_PORT: String(PORT + 10),
    DB_PATH,
    WORKSPACES_DIR: path.join(E2E_ROOT, 'ws'),
    ARTIFACTS_DIR: path.join(E2E_ROOT, 'art'),
    GENERATORAI_BIND_HOST: '127.0.0.1',
  });
  if (provider === 'faux') env.GENERATORAI_LOAD_TEST_FAUX_HARNESS = 'true';
  else env.HARNESS_TYPE = provider;

  const out = openSync(LOG_FILE, 'w');
  const child = spawn(process.execPath, [TSX_CLI,'--import', './src/instrumentation.ts', 'src/index.ts'], {
    cwd: path.join(REPO, 'apps', 'server'),
    env,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  // The OS creation time pins the record to THIS process (see verifyOwnServer).
  const created = processInfo(child.pid)?.created ?? null;
  writeFileSync(PID_FILE, JSON.stringify({ pid: child.pid, port: PORT, provider, created, startedAt: new Date().toISOString() }));
  let exited = null;
  child.once('exit', (code) => {
    exited = code;
  });
  log(`[e2e-server] started pid ${child.pid} (${provider}) → ${BASE_URL}, log ${LOG_FILE}`);
  try {
    const health = await Promise.race([
      waitForHealth(timeoutMs),
      new Promise((_, reject) => {
        const t = setInterval(() => {
          if (exited !== null) {
            clearInterval(t);
            reject(new Error(`server exited with code ${exited} before becoming healthy; see ${LOG_FILE}`));
          }
        }, 500);
        t.unref();
      }),
    ]);
    log(`[e2e-server] healthy`);
    return { pid: child.pid, baseUrl: BASE_URL, health };
  } catch (err) {
    await stopServer({ log });
    throw err;
  }
}

/** Kill the process tree recorded in the pid file — and nothing else. */
export async function stopServer({ log = console.log } = {}) {
  const pf = readPidFile();
  if (!pf) {
    log('[e2e-server] no pid file; nothing to stop');
    return false;
  }
  const check = verifyOwnServer(pf);
  if (check.reason === 'not running') {
    log(`[e2e-server] pid ${pf.pid} is not running`);
  } else if (!check.ok) {
    log(`[e2e-server] pid ${pf.pid}: ${check.reason}; refusing to kill it`);
    unlinkSync(PID_FILE);
    return false;
  } else {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(pf.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
    } else {
      try {
        process.kill(pf.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    log(`[e2e-server] stopped pid ${pf.pid}`);
  }
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  // Give the OS a moment to release the port.
  const deadline = Date.now() + 10_000;
  while ((await isListening(PORT)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  return true;
}

export async function serverStatus() {
  const pf = readPidFile();
  return { pidFile: pf, alive: pf ? !!processInfo(pf.pid) : false, ownServer: pf ? verifyOwnServer(pf) : null, listening: await isListening(PORT) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd = 'status', ...rest] = process.argv.slice(2);
  const flag = (n) => {
    const i = rest.indexOf(`--${n}`);
    return i === -1 ? undefined : (rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : true);
  };
  const run = async () => {
    if (cmd === 'start') {
      await startServer({ provider: flag('provider') ?? 'claude-agent', fresh: !!flag('fresh') });
    } else if (cmd === 'stop') {
      await stopServer();
    } else {
      console.log(JSON.stringify(await serverStatus(), null, 2));
    }
  };
  run().catch((err) => {
    console.error(`[e2e-server] ${err.message}`);
    process.exit(1);
  });
}

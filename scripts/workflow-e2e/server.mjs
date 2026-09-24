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
// /api/health, and records its PID in C:/gaiwf/e2e-server.pid. `stop` kills
// ONLY that process tree, after checking the PID still belongs to a server
// this script started. It never touches port 3100 or the real DB.
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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const E2E_ROOT = process.env.E2E_ROOT ?? 'C:/gaiwf';
export const PORT = Number(process.env.E2E_PORT ?? 3111);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
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
    s.setTimeout(1000, () => done(false));
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

/** Command line of a live process, or null when it is gone. */
function commandLineOf(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
        { encoding: 'utf8' },
      ).trim();
      return out || null;
    }
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
  } catch {
    return null;
  }
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

  const tsxCli = path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const out = openSync(LOG_FILE, 'w');
  const child = spawn(process.execPath, [tsxCli, '--import', './src/instrumentation.ts', 'src/index.ts'], {
    cwd: path.join(REPO, 'apps', 'server'),
    env,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  writeFileSync(PID_FILE, JSON.stringify({ pid: child.pid, port: PORT, provider, startedAt: new Date().toISOString() }));
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
  const cmd = commandLineOf(pf.pid);
  if (!cmd) {
    log(`[e2e-server] pid ${pf.pid} is not running`);
  } else if (!/src[\\/]index\.ts|tsx/.test(cmd)) {
    log(`[e2e-server] pid ${pf.pid} is not an E2E server (${cmd.slice(0, 80)}…); refusing to kill it`);
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
  return { pidFile: pf, alive: pf ? !!commandLineOf(pf.pid) : false, listening: await isListening(PORT) };
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

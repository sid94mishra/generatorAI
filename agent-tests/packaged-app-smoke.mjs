// ────────────────────────────────────────────────────────────────
// packaged-app-smoke — launches the PACKAGED desktop app (the real .exe /
// .app / AppImage produced by electron-builder) and proves it works end to
// end.
//
// This is deliberately separate from the other desktop smokes, which all run
// the *unpackaged* build against the monorepo. That configuration cannot
// catch the whole class of packaging bugs — unresolved imports, missing
// native binaries, wrong asset paths — because the monorepo's node_modules
// is sitting right there to paper over them.
//
// The packaged binary ships with the RunAsNode, NODE_OPTIONS and --inspect
// fuses off (F-4, D-128), so Playwright's `_electron.launch` — which drives
// the main process through the Node inspector — cannot attach to it. The app
// is started as a user would start it, with Chromium's remote-debugging switch
// for the renderer only, and the hardening itself is checked: the fuse wire,
// the server running in a utility process with no vault key in its
// environment (F-8), and ELECTRON_RUN_AS_NODE / NODE_OPTIONS / --inspect
// having no effect.
//
// Run: node agent-tests/packaged-app-smoke.mjs
// Requires: pnpm --filter @generatorai/desktop package:dir (or package)
// ────────────────────────────────────────────────────────────────

import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
import { isolatedProfile } from './helpers/desktop-profile.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** @electron/fuses' wire values (its FuseState enum is not exported from the package root). */
const FuseState = { DISABLE: 48, ENABLE: 49 };
const RELEASE = path.resolve(__dirname, '..', 'apps', 'desktop', 'release');
const SHOTS = path.resolve(__dirname, 'test-results', 'packaged');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * The packaged app for whichever platform built it: the executable, the
 * `resources` directory, and the file @electron/fuses reads (the .app bundle
 * on macOS, the executable elsewhere). electron-builder names the output
 * directory after the architecture (`mac-arm64`, `win-arm64-unpacked`, …).
 */
function findApp() {
  const dirs = fs.existsSync(RELEASE) ? fs.readdirSync(RELEASE) : [];
  if (process.platform === 'darwin') {
    for (const d of dirs.filter((n) => /^mac(-|$)/.test(n))) {
      const bundle = path.join(RELEASE, d, 'GeneratorAI.app');
      const exe = path.join(bundle, 'Contents', 'MacOS', 'GeneratorAI');
      if (fs.existsSync(exe)) return { executablePath: exe, resources: path.join(bundle, 'Contents', 'Resources'), fuseTarget: bundle };
    }
    return null;
  }
  const [unpacked, name] = process.platform === 'win32' ? [/^win-.*unpacked$/, 'GeneratorAI.exe'] : [/^linux-.*unpacked$/, 'generatorai'];
  for (const d of dirs.filter((n) => unpacked.test(n))) {
    const exe = path.join(RELEASE, d, name);
    if (fs.existsSync(exe)) return { executablePath: exe, resources: path.join(RELEASE, d, 'resources'), fuseTarget: exe };
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Ends a launched app and everything under it (the utility processes go with it). */
async function stopApp(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t'], { windowsHide: true });
  else child.kill('SIGTERM');
  const done = await Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 20_000))]);
  if (!done) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    else child.kill('SIGKILL');
    await exited;
  }
}

/** POSIX: the pid listening on a loopback port, its command line and its start-up environment. */
function processOn(port) {
  if (process.platform === 'win32') return null;
  try {
    const pid = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0];
    if (!pid) return null;
    const command = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).trim();
    const environ =
      process.platform === 'linux'
        ? fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').join(' ')
        : execFileSync('ps', ['eww', '-o', 'command=', '-p', pid], { encoding: 'utf8' });
    return { pid, command, environ };
  } catch {
    return null;
  }
}

/**
 * Starts the binary with an injection attempt and an isolated profile, and
 * reports whether the injected code ran. With the fuses off, the app simply
 * starts as itself (and is stopped again).
 */
async function injectionRan(executablePath, { env = {}, args = [] }, marker) {
  const profile = isolatedProfile('gai-packaged-probe-');
  const child = spawn(executablePath, [...args, profile.arg], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (b) => (out += b));
  child.stderr.on('data', (b) => (out += b));
  await new Promise((r) => setTimeout(r, 8_000));
  await stopApp(child);
  profile.cleanup();
  return marker(out);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  const found = findApp();
  check('packaged executable exists', Boolean(found), found?.executablePath ?? 'not found');
  if (!found) return;
  const { executablePath, resources, fuseTarget } = found;

  // ── Fuses (F-4) ──
  const wire = await getCurrentFuseWire(fuseTarget);
  const expected = {
    RunAsNode: FuseState.DISABLE,
    EnableNodeOptionsEnvironmentVariable: FuseState.DISABLE,
    EnableNodeCliInspectArguments: FuseState.DISABLE,
    EnableEmbeddedAsarIntegrityValidation: FuseState.ENABLE,
    OnlyLoadAppFromAsar: FuseState.ENABLE,
    EnableCookieEncryption: FuseState.ENABLE,
    GrantFileProtocolExtraPrivileges: FuseState.DISABLE,
  };
  for (const [name, state] of Object.entries(expected)) {
    check(`fuse ${name} is ${state === FuseState.ENABLE ? 'on' : 'off'}`, wire[FuseV1Options[name]] === state, `wire=${wire[FuseV1Options[name]]}`);
  }

  // ── Payload layout ──
  // Cheap to assert and pinpoints a broken `extraResources` mapping far more
  // precisely than a launch failure would.
  check('server bundle shipped', fs.existsSync(path.join(resources, 'server', 'server.mjs')));
  check(
    'native sqlite binding shipped',
    fs.existsSync(
      path.join(resources, 'server', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    ),
  );
  check('web UI shipped', fs.existsSync(path.join(resources, 'web', 'dist', 'index.html')));
  check('templates shipped', fs.existsSync(path.join(resources, 'templates')));
  check(
    'unbundled server dist NOT shipped',
    !fs.existsSync(path.join(resources, 'server', 'dist')),
    'the tsc output would be dead weight and cannot run',
  );

  // ── The binary ignores the injection doors the fuses close ──
  const probeFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gai-fuse-probe-')), 'probe.cjs');
  const ranMarker = path.join(path.dirname(probeFile), 'ran');
  fs.writeFileSync(probeFile, `require('fs').writeFileSync(${JSON.stringify(ranMarker)}, 'x');`);
  check(
    'ELECTRON_RUN_AS_NODE does not turn the app into Node',
    !(await injectionRan(executablePath, { env: { ELECTRON_RUN_AS_NODE: '1' }, args: ['-e', 'process.stdout.write("NODE-RAN"); process.exit(0)'] }, (out) => out.includes('NODE-RAN'))),
  );
  check(
    'NODE_OPTIONS --require is ignored',
    !(await injectionRan(executablePath, { env: { NODE_OPTIONS: `--require ${probeFile}` } }, () => fs.existsSync(ranMarker))),
  );
  check(
    '--inspect opens no debugger',
    !(await injectionRan(executablePath, { args: ['--inspect=0'] }, (out) => /Debugger listening/.test(out))),
  );
  fs.rmSync(path.dirname(probeFile), { recursive: true, force: true });

  // A fresh profile: never the installed app's real userData or vault key.
  const profile = isolatedProfile('gai-packaged-smoke-');
  process.on('exit', profile.cleanup);
  const debugPort = await freePort();
  const appProcess = spawn(executablePath, [profile.arg, `--remote-debugging-port=${debugPort}`], {
    env: process.env,
    stdio: 'ignore',
  });
  // P2-R44 — a SIGINT/SIGTERM that lands after this point stops the app before
  // removing the directory it may still hold files in.
  profile.attach({ close: () => stopApp(appProcess) });

  let browser = null;
  try {
  // The splash window shows first; wait for the one hosting the SPA, which
  // only appears once the embedded server is actually listening.
  let win = null;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !win) {
    if (!browser) browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`).catch(() => null);
    for (const w of browser ? browser.contexts().flatMap((c) => c.pages()) : []) {
      const url = w.url();
      if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) win = w;
    }
    if (!win) await new Promise((r) => setTimeout(r, 1000));
  }

  check('embedded server started and SPA loaded', Boolean(win), win ? '' : 'no http window appeared');
  if (!win) {
    return;
  }

  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('[data-testid="app-frame"]', { timeout: 120_000 });
  check('app shell rendered', true);

  // ── The embedded server is genuinely serving ──
  const health = await win.evaluate(async () => {
    try {
      const res = await fetch('/api/health');
      return { status: res.status, body: await res.json() };
    } catch (e) {
      return { status: 0, body: String(e) };
    }
  });
  check('GET /api/health returns 200', health.status === 200, `status=${health.status}`);
  check('database opened (native module loaded)', health.body?.db === true, JSON.stringify(health.body?.db));

  // ── The server is a utility process and its environment holds no vault key (F-4, F-8) ──
  const server = processOn(new URL(win.url()).port);
  if (process.platform !== 'win32') {
    check('server process found', Boolean(server), server ? `pid=${server.pid}` : 'lsof found no listener');
    if (server) {
      check('server runs as an Electron utility process', /--type=utility/.test(server.command), server.command.slice(0, 160));
      check('server environment carries no vault key', !/GENERATORAI_SECRET_KEY=\S/.test(server.environ));
      check('server environment has no ELECTRON_RUN_AS_NODE', !/ELECTRON_RUN_AS_NODE=/.test(server.environ));
    }
  }

  // A packaged app that silently falls back to unauthenticated mode would be
  // a serious regression, so assert the posture rather than assuming it.
  const posture = await win.evaluate(async () => {
    try {
      const res = await fetch('/api/security/posture');
      return { status: res.status, body: await res.json() };
    } catch {
      return { status: 0, body: null };
    }
  });
  check('security posture reachable', posture.status === 200, `status=${posture.status}`);
  check(
    'authentication is required',
    posture.body?.authentication?.required === true,
    JSON.stringify(posture.body?.authentication),
  );
  check(
    'unauthenticated loopback is OFF',
    posture.body?.authentication?.unauthenticatedLoopback === false,
    String(posture.body?.authentication?.unauthenticatedLoopback),
  );

  // ── Native browser is the default in the packaged app ──
  // Without this the browser panel falls through to ServerPlaywrightHost,
  // which needs Chromium binaries no installer ships.
  const nativeBrowser = await win.evaluate(async () => {
    const api = window.generatoraiDesktop?.browser;
    return api ? await api.available() : null;
  });
  check('native browser enabled by default', nativeBrowser === true, String(nativeBrowser));

  // ── Window chrome survived packaging ──
  // The preload exposes the chrome synchronously as a plain value (06 §3.6);
  // the old async getWindowChrome() IPC is gone.
  const chrome = await win.evaluate(() => {
    const api = window.generatoraiDesktop;
    return {
      value: api?.chrome ?? null,
      legacyGetter: typeof api?.getWindowChrome,
    };
  });
  check(
    'window chrome bridge works',
    Boolean(chrome.value) && chrome.value.platform === process.platform,
    JSON.stringify(chrome.value),
  );
  check('getWindowChrome() is removed', chrome.legacyGetter === 'undefined', chrome.legacyGetter);
  // The launched app inherits this process's env, so the Linux opt-in flag
  // decides the expected chrome the same way platform.ts does.
  const expectedStyle =
    process.platform === 'darwin'
      ? 'hidden-inset'
      : process.platform === 'win32' || process.env.GENERATORAI_LINUX_CUSTOM_TITLEBAR === '1'
        ? 'overlay'
        : 'native';
  check(
    `chrome is ${expectedStyle} on ${process.platform}`,
    chrome.value?.titleBarStyle === expectedStyle,
    String(chrome.value?.titleBarStyle),
  );
  // The 36px title strip exists only in the `overlay` chrome (Windows, Linux
  // with GENERATORAI_LINUX_CUSTOM_TITLEBAR); macOS and the Linux native frame
  // have none.
  const wantsStrip = chrome.value?.titleBarStyle === 'overlay';
  const hasStrip = Boolean(await win.$('[data-testid="app-titlebar"]'));
  check(
    wantsStrip ? 'title strip present (overlay chrome)' : `no title strip (${chrome.value?.titleBarStyle} chrome)`,
    hasStrip === wantsStrip,
    `titleBarStyle=${chrome.value?.titleBarStyle}, strip=${hasStrip}`,
  );

  await win.screenshot({ path: path.join(SHOTS, 'packaged-app.png') });
  console.log(`\n  screenshot → ${path.join(SHOTS, 'packaged-app.png')}`);
  } finally {
    // P2-R44 — close before cleanup: the directory is only removed once
    // Electron (and the embedded server it spawned) has released its files.
    await browser?.close().catch(() => {});
    await stopApp(appProcess);
    profile.cleanup();
  }
}

main()
  .then(() => {
    console.log(`\n${pass}/${pass + fail} checks passed`);
    if (failures.length) {
      console.log('\nFailures:');
      for (const f of failures) console.log(`  • ${f}`);
    }
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('\nHARNESS ERROR', err);
    process.exit(1);
  });

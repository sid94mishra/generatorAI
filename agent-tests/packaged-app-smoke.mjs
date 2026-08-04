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
// Run: node agent-tests/packaged-app-smoke.mjs
// Requires: pnpm --filter @generatorai/desktop package:dir
// ────────────────────────────────────────────────────────────────

import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UNPACKED = path.resolve(__dirname, '..', 'apps', 'desktop', 'release', 'win-unpacked');
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

/** Locates the packaged executable for whichever platform built it. */
function findExecutable() {
  if (process.platform === 'win32') {
    const exe = path.join(UNPACKED, 'GeneratorAI.exe');
    return fs.existsSync(exe) ? exe : null;
  }
  const base = path.resolve(__dirname, '..', 'apps', 'desktop', 'release');
  if (process.platform === 'darwin') {
    const app = path.join(base, 'mac', 'GeneratorAI.app', 'Contents', 'MacOS', 'GeneratorAI');
    return fs.existsSync(app) ? app : null;
  }
  const bin = path.join(base, 'linux-unpacked', 'generatorai');
  return fs.existsSync(bin) ? bin : null;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  const executablePath = findExecutable();
  check('packaged executable exists', Boolean(executablePath), executablePath ?? 'not found');
  if (!executablePath) return;

  const resources = path.resolve(path.dirname(executablePath), 'resources');

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

  const app = await electron.launch({
    executablePath,
    args: [],
    timeout: 180_000,
  });

  // The splash window shows first; wait for the one hosting the SPA, which
  // only appears once the embedded server is actually listening.
  let win = null;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !win) {
    for (const w of app.windows()) {
      const url = w.url();
      if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) win = w;
    }
    if (!win) await new Promise((r) => setTimeout(r, 1000));
  }

  check('embedded server started and SPA loaded', Boolean(win), win ? '' : 'no http window appeared');
  if (!win) {
    await app.close();
    return;
  }

  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('[data-testid="app-header"]', { timeout: 120_000 });
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
  const chrome = await win.evaluate(async () =>
    window.generatoraiDesktop?.getWindowChrome ? await window.generatoraiDesktop.getWindowChrome() : null,
  );
  check('window chrome bridge works', Boolean(chrome), JSON.stringify(chrome));
  check('title bar row present', Boolean(await win.$('[data-testid="app-titlebar"]')));

  await win.screenshot({ path: path.join(SHOTS, 'packaged-app.png') });
  console.log(`\n  screenshot → ${path.join(SHOTS, 'packaged-app.png')}`);

  await app.close();
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

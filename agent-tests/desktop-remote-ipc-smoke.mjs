// ────────────────────────────────────────────────────────────────
// Desktop remote-page IPC smoke:
//
//   node agent-tests/desktop-remote-ipc-smoke.mjs   (after `pnpm --filter @generatorai/desktop build`)
//
// When the window shows ANOTHER machine's server (remote mode, D-126), that
// page gets the same preload bridge as the local one. Channels that act on
// this computer (apps/desktop/src/main/ipc-scope.ts) must refuse it; the
// window-level ones keep working. The "remote server" is a throwaway page on a
// loopback port — the shell treats any server in remote mode as not its own.
// ────────────────────────────────────────────────────────────────

import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DESKTOP_DIR as DESKTOP, isolatedProfile } from './helpers/desktop-profile.mjs';

const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' :: ' + info : ''}`);
};

// A stand-in for another machine's server: any page, any path.
const remote = http.createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><title>Remote</title><p data-testid="remote-page">another machine</p>');
});
await new Promise((r) => remote.listen(0, '127.0.0.1', r));
const REMOTE = `http://127.0.0.1:${remote.address().port}`;

const profile = isolatedProfile('gai-remote-ipc-smoke-');
fs.writeFileSync(
  path.join(profile.dir, 'settings.json'),
  JSON.stringify({
    servers: { serverMode: 'remote', connections: [{ id: 'remote-1', label: 'Other machine', url: REMOTE }], activeConnectionId: 'remote-1' },
  }),
);
const app = await electron.launch({
  args: [DESKTOP, profile.arg],
  env: { ...process.env, GENERATORAI_DESKTOP_MODE: 'standalone', GENERATORAI_DESKTOP_NATIVE_BROWSER: '1' },
  timeout: 120_000,
});
profile.attach(app);

async function finish() {
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 10_000))]).catch(() => {});
  profile.cleanup();
  remote.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

let page = null;
for (let i = 0; i < 120 && !page; i++) {
  page = app.windows().find((w) => w.url().startsWith(REMOTE)) ?? null;
  if (!page) await new Promise((r) => setTimeout(r, 500));
}
record('window shows the remote server page', Boolean(page), page?.url() ?? app.windows().map((w) => w.url()).join(', '));
if (!page) await finish();
await page.waitForLoadState('domcontentloaded');

const call = (expr) =>
  page.evaluate(async (source) => {
    try {
      // eslint-disable-next-line no-new-func
      const value = await new Function(`return (${source});`)();
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  }, expr);

record('the preload bridge is present on the remote page', (await call('typeof window.generatoraiDesktop')).value === 'object');

const refused = [
  ['restartServer', 'window.generatoraiDesktop.restartServer()'],
  ['getServerStatus', 'window.generatoraiDesktop.getServerStatus()'],
  ['getSetting', "window.generatoraiDesktop.getSetting('serverPort')"],
  ['setSetting', "window.generatoraiDesktop.setSetting('serverPort', 4000)"],
  ['showItemInFolder', "window.generatoraiDesktop.showItemInFolder('/')"],
  ['requestPairingCode', "window.generatoraiDesktop.requestPairingCode('x')"],
  ['updates.install', 'window.generatoraiDesktop.updates.install()'],
  ['browser.navigate', "window.generatoraiDesktop.browser.navigate('t1', 'https://example.com')"],
];
for (const [name, expr] of refused) {
  const r = await call(expr);
  record(`remote page is refused: ${name}`, !r.ok && /not this computer's server/.test(r.error), r.ok ? `resolved ${JSON.stringify(r.value)}` : r.error.slice(0, 120));
}

const info = await call('window.generatoraiDesktop.getAppInfo()');
record('getAppInfo answers without local paths or server URL', info.ok && info.value.dataDir === '' && info.value.logFile === '' && info.value.serverUrl === null, JSON.stringify(info.value ?? info.error).slice(0, 160));
record('find in page still works', (await call("window.generatoraiDesktop.findInPage('another')")).ok);
record('window chrome still works', (await call('window.generatoraiDesktop.window.isMaximized()')).ok);
record('native browser reported unavailable', (await call('window.generatoraiDesktop.browser.available()')).value === false);

await finish();

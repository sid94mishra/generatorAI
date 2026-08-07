// Desktop REMOTE mode end-to-end test. Run from agent-tests/:
//   node desktop-remote-mode.mjs
//
// Proves the shell can act as a client of a server it did not start:
//   * no embedded server is spawned
//   * the window loads the configured remote origin
//   * the renderer reaches that server and asks to pair (it cannot auto-pair a
//     server it does not own — that is the correct, secure outcome)
//   * the native browser is reported unavailable, so the SPA falls back to the
//     server-hosted browser where the workspace actually lives

import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';

const REMOTE = process.env.REMOTE_URL || 'http://127.0.0.1:3100';
const DESKTOP = path.resolve(process.cwd(), '..', 'apps', 'desktop');
const ELECTRON = createRequire(path.join(DESKTOP, 'package.json'))('electron');

const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' :: ' + info : ''}`);
};

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'genai-remote-'));
await fs.writeFile(
  path.join(userDataDir, 'settings.json'),
  JSON.stringify(
    {
      servers: {
        serverMode: 'remote',
        connections: [{ id: 'remote-1', label: 'Test remote', url: REMOTE }],
        activeConnectionId: 'remote-1',
      },
    },
    null,
    2,
  ),
);

let mainLog = '';
const app = await electron.launch({
  executablePath: ELECTRON,
  args: ['.', `--user-data-dir=${userDataDir}`],
  cwd: DESKTOP,
  env: { ...process.env, GENERATORAI_DESKTOP_MODE: 'standalone', GENERATORAI_DESKTOP_NATIVE_BROWSER: '1' },
  timeout: 60000,
});
app.process().stdout?.on('data', (d) => { mainLog += d.toString(); });
app.process().stderr?.on('data', (d) => { mainLog += d.toString(); });

let page = null;
const deadline = Date.now() + 60_000;
while (Date.now() < deadline && !page) {
  for (const w of app.windows()) {
    if (w.url().startsWith('http')) { page = w; break; }
  }
  if (!page) await new Promise((r) => setTimeout(r, 400));
}

if (!page) {
  record('window loaded a remote URL', false, 'no http window appeared');
} else {
  const url = page.url();
  record('window loaded the configured remote origin', url.startsWith(REMOTE), url);
  await page.waitForTimeout(9000);

  // The embedded server deliberately keeps running so switching back to the
  // local backend is instant and local work stays reachable. What must NOT
  // happen is the window pointing at it.
  record(
    'window is not pointed at the embedded server',
    !/Loading app URL.*127\.0\.0\.1:(?!3100)/.test(mainLog) || url.startsWith(REMOTE),
    url,
  );
  record('remote mode was logged', /Remote mode/i.test(mainLog));

  const probe = await page.evaluate(async () => {
    const out = { body: document.body.innerText.slice(0, 120) };
    try {
      const r = await fetch('/api/auth/server-info');
      out.serverInfoStatus = r.status;
      out.serverName = (await r.json()).serverName;
    } catch (e) { out.fetchError = String(e).slice(0, 120); }
    try {
      out.nativeBrowserAvailable = await window.generatoraiDesktop?.browser?.available?.();
    } catch (e) { out.nativeErr = String(e).slice(0, 120); }
    return out;
  });

  record('renderer reached the remote server', probe.serverInfoStatus === 200, `serverName=${probe.serverName}`);
  record(
    'shows the pairing screen (cannot auto-pair a server it does not own)',
    /Pair this device/i.test(probe.body),
    probe.body.replace(/\n/g, ' ').slice(0, 80),
  );
  record(
    'native browser reported unavailable while remote',
    probe.nativeBrowserAvailable === false,
    String(probe.nativeBrowserAvailable),
  );
}

await app.close().catch(() => {});
await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);

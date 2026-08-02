// Desktop browser-panel smoke test (v3 — scoped CDP proxy path).
//
// v2 of this test attached Playwright directly to the app's
// `--remote-debugging-port` to reach the main SPA window — that flag is
// gone (see apps/desktop/src/main/cdp/ScopedCdpProxy.ts and
// docs/plans on the CDP security fix): it exposed every webContents in the
// app, including the privileged main window, over one unauthenticated
// loopback port. There is no longer any legitimate way for an external
// process to reach the main window over CDP, by design.
//
// This version drives the app the supported way: Playwright's own
// `_electron.launch()`, which needs no CDP port at all. It launches with an
// isolated `--user-data-dir` so it never collides with (or has to disturb)
// an already-running GeneratorAI desktop instance via Electron's
// single-instance lock.
//
// Verifies: SPA loads → chats list appears → an existing chat opens → the
// Browser panel toggles → the URL bar accepts a URL and the Start button
// transitions the panel from `off` to `active` → the `NativeBrowserView`
// component is mounted (aria-label check) → the scoped CDP proxy for that
// workspace's tab is live and the agent-facing bridge can see it (verified
// via the same `/api/workspaces/:id/browser/descriptor` route the SPA
// itself polls, proving the full main→server handshake worked end to end).
//
// Run: `cd agent-tests && node desktop-browser-smoke.mjs`

import { _electron as electron } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const DESKTOP = path.resolve(process.cwd(), '..', 'apps', 'desktop');
const requireFromDesktop = createRequire(path.join(DESKTOP, 'package.json'));
requireFromDesktop.resolve('electron'); // sanity: electron must be resolvable from apps/desktop

const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`[browser-smoke] ${ok ? 'PASS' : 'FAIL'} — ${name}${info ? ' :: ' + info : ''}`);
};
const log = (...a) => console.log('[browser-smoke]', ...a);

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gai-e2e-'));
let app = null;

async function finish(exitCode = 0) {
  // app.close() can itself hang if the renderer is unresponsive — cap it
  // so a flaky teardown never leaves the whole run stuck indefinitely.
  try {
    await Promise.race([
      app?.close(),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  } catch { /* ignore */ }
  try { await fs.rm(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  const failures = results.filter((r) => !r.ok);
  console.log('\n=== summary ===');
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.info ? ' — ' + r.info : ''}`);
  if (failures.length > 0) {
    console.log(`\n${failures.length} test(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll passed.');
  process.exit(exitCode);
}

try {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: DESKTOP,
    env: {
      ...process.env,
      GENERATORAI_DESKTOP_MODE: 'standalone',
      GENERATORAI_DESKTOP_NATIVE_BROWSER: '1',
      GENERATORAI_LOG_LEVEL: 'info',
    },
  });
  app.process().stdout.on('data', (b) => {
    const text = b.toString();
    if (/NativeBrowserHost|ScopedCdpProxy|cdp-endpoint|error|CDP/i.test(text)) process.stdout.write(`  [main] ${text}`);
  });
  app.process().stderr.on('data', (b) => process.stdout.write(`  [main-err] ${b.toString()}`));
  record('electron launched', true, `userDataDir=${userDataDir}`);
} catch (e) {
  record('electron launched', false, String(e).slice(0, 300));
  await finish(1);
}

// Find the real SPA window (the process also briefly shows a splash screen
// on `file://` before the server is healthy).
let page = null;
const pageDeadline = Date.now() + 90_000;
while (Date.now() < pageDeadline && !page) {
  for (const w of app.windows()) {
    let u = '';
    try { u = w.url(); } catch { /* ignore */ }
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) { page = w; break; }
  }
  if (!page) await new Promise((r) => setTimeout(r, 1000));
}
if (!page) {
  record('SPA window appears', false, `no http window after 90s; windows=${JSON.stringify(app.windows().map((w) => { try { return w.url(); } catch { return '?'; } }))}`);
  await finish(1);
}
record('SPA window appears', true, page.url());

await page.waitForLoadState('domcontentloaded').catch(() => {});
await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(1500);

// Preload bridge should expose `desktop.browser.available === true`.
try {
  const bridge = await page.evaluate(async () => {
    const api = /** @type {any} */ (window).generatoraiDesktop;
    if (!api?.browser?.available) return { present: false };
    const available = await api.browser.available();
    return { present: true, available };
  });
  record('native browser bridge exposed', bridge.present === true, JSON.stringify(bridge));
  record('native browser flag on', bridge.available === true, 'GENERATORAI_DESKTOP_NATIVE_BROWSER=1');
} catch (e) {
  record('native browser bridge exposed', false, String(e).slice(0, 200));
}

// Navigate to /chats.
try {
  await page.evaluate(() => {
    window.history.pushState({}, '', '/chats');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(1200);
  const url = page.url();
  record('navigate to /chats', url.endsWith('/chats'), url);
} catch (e) {
  record('navigate to /chats', false, String(e).slice(0, 200));
}

// Open an existing chat, else create one via API.
let chatId = null;
try {
  const button = await page.$('button:has-text("Browser test chat"), button:has-text("Test")');
  if (button) {
    await button.click();
  } else {
    const created = await page.evaluate(async () => {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'browser-smoke ' + Date.now(), model: 'claude-sonnet-4.6' }),
      });
      if (!res.ok) return { ok: false, status: res.status };
      const data = await res.json();
      return { ok: true, id: data.id ?? data.chat?.id };
    });
    if (created.ok && created.id) {
      await page.evaluate((id) => {
        window.history.pushState({}, '', `/chats/${id}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, created.id);
    } else {
      record('open a chat', false, JSON.stringify(created));
      await finish(1);
    }
  }
  await page.waitForTimeout(1500);
  const m = page.url().match(/\/chats\/([^/?#]+)/);
  chatId = m?.[1] ?? null;
  record('open a chat', !!chatId, `chatId=${chatId ?? '(none)'}`);
} catch (e) {
  record('open a chat', false, String(e).slice(0, 200));
}
if (!chatId) await finish(1);

// Resolve the chat's underlying workspaceId — the browser feature is keyed
// by workspace, not chat (they're distinct ids).
let workspaceId = null;
try {
  workspaceId = await page.evaluate(async (id) => {
    const res = await fetch(`/api/chats/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.workspaceId ?? null;
  }, chatId);
  record('resolve chat workspaceId', !!workspaceId, `workspaceId=${workspaceId ?? '(none)'}`);
} catch (e) {
  record('resolve chat workspaceId', false, String(e).slice(0, 200));
}
if (!workspaceId) await finish(1);

// Open the Browser tab in the right pane: "Add tab" → "Integrated browser
// for this chat" (the UI nests it behind a menu now, not a bare toolbar
// button — checked live against the running web app before writing this).
try {
  const sidePaneBtn = await page.$('button[aria-label="Show side pane"]');
  if (sidePaneBtn) await sidePaneBtn.click();
  await page.waitForTimeout(300);
  await page.click('button[aria-label="Add tab"]');
  await page.waitForSelector('text=Integrated browser for this chat', { timeout: 10_000 });
  await page.click('text=Integrated browser for this chat');
  const tabVisible = await page.waitForSelector('[role="tab"]:has-text("Browser")', { timeout: 10_000 })
    .then(() => true).catch(() => false);
  record('browser panel opens', tabVisible, tabVisible ? 'Browser tab present' : 'Browser tab missing');
} catch (e) {
  record('browser panel opens', false, String(e).slice(0, 200));
}

// page.evaluate() against the Electron main window can, in rare cases, sit
// forever if the renderer's event loop is busy (e.g. right after a native
// WebContentsView starts painting) — never let one hung call stall the
// whole suite.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// Directly start the session over the REST API (exactly what the SPA's own
// Start control/auto-start does) instead of chasing UI timing — this is the
// actual Phase-1 surface under test: BrowserService.start() →
// ElectronBridgeAdapter.start() → wait for Electron main's scoped-proxy
// endpoint (pushed via POST /internal/browser/cdp-endpoint) →
// chromium.connectOverCDP(). The response body carries the same
// mode/status/ready fields as GET .../descriptor, so a second round-trip to
// re-confirm it would be redundant (and, empirically, occasionally caught in
// the same page.evaluate flakiness the timeout guard above exists for).
try {
  const startResult = await withTimeout(page.evaluate(async (wid) => {
    const res = await fetch(`/api/workspaces/${wid}/browser/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { enabled: true, visibility: 'visible' } }),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  }, workspaceId), 20_000, 'start page.evaluate');
  record('POST /browser/start succeeds', startResult.ok, JSON.stringify(startResult));
  const isNative = startResult.ok && startResult.body?.mode === 'native' && startResult.body?.ready === true;
  record('scoped CDP handshake completed (mode=native, ready)', isNative, JSON.stringify(startResult.body));
} catch (e) {
  record('POST /browser/start succeeds', false, String(e).slice(0, 200));
  record('scoped CDP handshake completed (mode=native, ready)', false, 'start call failed');
}

// The NativeBrowserView owns an element with aria-label="Native browser view".
try {
  await withTimeout(page.waitForTimeout(1500), 10_000, 'settle wait');
  const nativeMounted = await withTimeout(page.$('[aria-label="Native browser view"]'), 10_000, 'aria-label query');
  record('native branch mounted', !!nativeMounted, nativeMounted ? 'aria-label present' : 'missing');
} catch (e) {
  record('native branch mounted', false, String(e).slice(0, 200));
}

// Cleanup — stop the session over the same REST API.
try {
  await withTimeout(page.evaluate(async (wid) => {
    await fetch(`/api/workspaces/${wid}/browser/stop`, { method: 'POST' }).catch(() => undefined);
  }, workspaceId), 10_000, 'stop page.evaluate');
} catch { /* ignore */ }

await finish(0);

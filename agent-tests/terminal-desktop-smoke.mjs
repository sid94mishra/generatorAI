// Terminal desktop smoke — validates the Integrated Terminal tab works
// inside the Electron shell, mirroring the pattern of
// `right-pane-desktop-smoke.mjs`.
//
// Run manually:
//   cd agent-tests
//   node terminal-desktop-smoke.mjs
//
// Prereqs:
//   • Vite dev server on :5173  (pnpm --filter @generatorai/web dev)
//   • API server on :3100       (pnpm --filter @generatorai/server dev)

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const DESKTOP = path.resolve(process.cwd(), '..', 'apps', 'desktop');
const requireFromDesktop = createRequire(path.join(DESKTOP, 'package.json'));
const ELECTRON = requireFromDesktop('electron');

const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`[terminal-desktop] ${ok ? 'PASS' : 'FAIL'} — ${name}${info ? ' :: ' + info : ''}`);
};
const log = (...a) => console.log('[terminal-desktop]', ...a);

const DEBUG_PORT = 9226;

const child = spawn(ELECTRON, [`.`, `--remote-debugging-port=${DEBUG_PORT}`], {
  cwd: DESKTOP,
  env: {
    ...process.env,
    DESKTOP_DEV_SERVER_URL: 'http://localhost:5173',
    GENERATORAI_LOG_LEVEL: 'info',
  },
});

let stdoutBuf = '';
child.stdout?.on('data', (b) => { stdoutBuf += b.toString(); });
child.stderr?.on('data', (b) => { stdoutBuf += b.toString(); });

async function finish(code = 0) {
  try { child.kill(); } catch { /* ignore */ }
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== summary ===');
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.info ? ' — ' + r.info : ''}`);
  process.exit(failed.length > 0 ? 1 : code);
}

// Attach over CDP.
const deadline = Date.now() + 30_000;
let browser = null;
while (Date.now() < deadline && !browser) {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  } catch { /* not ready */ }
  if (!browser) await new Promise((r) => setTimeout(r, 400));
}
if (!browser) {
  record('electron attach', false, 'timeout waiting for CDP');
  await finish(1);
}
record('electron attach', true);

const contexts = browser.contexts();
const context = contexts[0] ?? await browser.newContext();
let page = null;
for (let i = 0; i < 60 && !page; i++) {
  page = context.pages().find((p) => p.url().startsWith('http')) ?? null;
  if (!page) await new Promise((r) => setTimeout(r, 500));
}
if (!page) { record('renderer found', false); await finish(1); }
record('renderer found', true, page.url());

// Reset the right-pane state so we always start fresh.
await page.evaluate(() => {
  for (const k of Object.keys(window.localStorage)) {
    if (k.startsWith('generatorai:rightPane:') || k.startsWith('generatorai:terminal:')) {
      window.localStorage.removeItem(k);
    }
  }
});

async function navigateSpa(pathname) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, pathname);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
}

async function findFirst(listPath) {
  return await page.evaluate(async (p) => {
    const res = await fetch(p);
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? list[0] : null;
  }, listPath);
}

// ── Flow: chat page → open right pane → add Terminal tab → verify ──
try {
  const chat = await findFirst('/api/chats?limit=1');
  if (!chat) throw new Error('no chat available; create one first');
  if (!chat.workspaceId) throw new Error(`chat ${chat.id} has no workspaceId — send one message first`);
  const workspaceId = chat.workspaceId;
  log(`chat=${chat.id} workspace=${workspaceId}`);
  await navigateSpa(`/chats/${chat.id}`);

  // Open the right pane.
  await page.waitForSelector('[data-testid="chat-toggle-right-pane"], [data-testid="chat-toggle-right-pane-banner"]', { timeout: 15_000 });
  const toggle = await page.$('[data-testid="chat-toggle-right-pane"]') ?? await page.$('[data-testid="chat-toggle-right-pane-banner"]');
  await toggle.click();
  await page.waitForSelector('[data-testid="right-pane"]', { timeout: 5_000 });
  record('chat: right pane opens', true);

  // Add the Terminal tab.
  await (await page.$('[data-testid="right-pane-add-tab"]')).click();
  await page.waitForSelector('[data-testid="right-pane-add-terminal"]', { timeout: 3_000 });
  await page.click('[data-testid="right-pane-add-terminal"]');
  await page.waitForSelector('[data-testid="right-pane-tab-terminal"]', { timeout: 5_000 });
  record('chat: Terminal tab added', true);

  // Terminal container should appear.
  await page.waitForSelector('[data-testid="terminal-container"]', { timeout: 5_000 });
  record('chat: xterm container rendered', true);

  // Server should now report at least one active terminal for this workspace.
  const listRes = await page.evaluate(async (wsid) => {
    const r = await fetch(`/api/workspaces/${wsid}/terminals`);
    return await r.json();
  }, workspaceId);
  const created = Array.isArray(listRes?.terminals) ? listRes.terminals.length : 0;
  record('server reports session', created >= 1, `count=${created}`);

  // Give the WS/PTY a moment to start.
  await page.waitForTimeout(1200);

  // Header should show either 'pty' or 'fallback' or 'sandbox'.
  const badgeText = await page.textContent('[data-testid="terminal-header"]').catch(() => '');
  const hasHostBadge = /(pty|fallback|sandbox)/.test(badgeText ?? '');
  record('header renders host badge', hasHostBadge, badgeText?.slice(0, 120));

  // Close the tab — should kill the server session.
  await page.click('button[aria-label="Close Terminal tab"]');
  await page.waitForTimeout(1500);

  const listAfter = await page.evaluate(async (wsid) => {
    const r = await fetch(`/api/workspaces/${wsid}/terminals`);
    return await r.json();
  }, workspaceId);
  const remaining = Array.isArray(listAfter?.terminals) ? listAfter.terminals.length : 0;
  record('close-tab kills session', remaining === 0, `count=${remaining}`);
} catch (e) {
  record('terminal chat flow', false, String(e).slice(0, 200));
}

await finish(0);

// Terminal desktop smoke — validates the Integrated Terminal tab works
// inside the Electron shell, mirroring `right-pane-desktop-smoke.mjs`.
//
// Run from the repo root after `pnpm --filter @generatorai/desktop build`:
//   node agent-tests/terminal-desktop-smoke.mjs

import { _electron as electron } from 'playwright';
import { DESKTOP_DIR as DESKTOP, isolatedProfile } from './helpers/desktop-profile.mjs';


const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`[terminal-desktop] ${ok ? 'PASS' : 'FAIL'} — ${name}${info ? ' :: ' + info : ''}`);
};
const log = (...a) => console.log('[terminal-desktop]', ...a);

// Launch through Playwright's Electron driver with a throwaway profile and the
// built renderer on the embedded server (standalone): no dev server, no
// developer profile, no :3100/:5173 (09 §6.5, agent-tests/helpers/desktop-profile.mjs).
const profile = isolatedProfile('gai-terminal-smoke-');
process.on('exit', profile.cleanup);
const app = await electron.launch({
  args: [DESKTOP, profile.arg],
  // Faux harness: the chat/run this smoke creates never reaches a real provider.
  env: {
    ...process.env,
    GENERATORAI_DESKTOP_MODE: 'standalone',
    NODE_ENV: 'production',
    GENERATORAI_LOG_LEVEL: 'info',
    GENERATORAI_TEST_FAUX_HARNESS: 'true',
  },
  timeout: 120_000,
});
profile.attach(app);

async function finish(code = 0) {
  try { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 10_000))]); } catch { /* ignore */ }
  profile.cleanup();
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== summary ===');
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.info ? ' — ' + r.info : ''}`);
  process.exit(failed.length > 0 ? 1 : code);
}
record('electron attach', true);

let page = null;
for (let i = 0; i < 120 && !page; i++) {
  // The window opens on the splash (file://) and then loads the embedded server's SPA.
  page = app.windows().find((p) => /^https?:/.test(p.url())) ?? null;
  if (!page) await new Promise((r) => setTimeout(r, 500));
}
if (!page) { record('renderer found', false); await finish(1); }
record('renderer found', true, page.url());
// The SPA pairs with the embedded server before its first API call; wait for
// the app frame so the smoke's own fetches go out paired.
await page.getByTestId('app-frame').waitFor({ timeout: 60_000 });

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
    const data = await res.json();
    // `/api/chats` answers a page (`{ items, ... }`), not a bare array.
    const list = Array.isArray(data) ? data : data?.items;
    return Array.isArray(list) && list.length > 0 ? list[0] : null;
  }, listPath);
}


/** POST from the page (paired by the SPA); returns the parsed body or throws. */
async function apiPost(pathname, body) {
  return page.evaluate(async ({ p, b }) => {
    const res = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    if (!res.ok) throw new Error(`${p} → ${res.status}`);
    return res.status === 204 ? null : res.json();
  }, { p: pathname, b: body });
}

/** A fresh profile has no data: create a chat (it gets its workspace on creation). */
async function createChat(name) {
  const data = await apiPost('/api/chats', { name });
  return data.chat ?? data;
}

// ── Flow: chat page → open right pane → add Terminal tab → verify ──
try {
  const chat = (await findFirst('/api/chats?limit=1')) ?? (await createChat(`terminal-smoke ${Date.now()}`));
  if (!chat.workspaceId) throw new Error(`chat ${chat.id} has no workspaceId — send one message first`);
  const workspaceId = chat.workspaceId;
  log(`chat=${chat.id} workspace=${workspaceId}`);
  await navigateSpa(`/chats/${chat.id}`);

  // Open the dock with the chat header's toggle (`dock-toggle`, P4-12).
  await page.waitForSelector('[data-testid="dock-toggle"]', { timeout: 15_000 });
  const toggle = await page.$('[data-testid="dock-toggle"]');
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
  // Terminal is pinned in the chat dock; "+" adds a second, closable instance ("Terminal 2").
  await page.click('button[aria-label^="Close Terminal"]');
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

// Focused smoke test for the unified RightPane feature.
//
// Launches the packaged Electron desktop shell against the running Vite
// dev server (http://localhost:5173) so the renderer is identical to the
// web build, then drives the new right-pane on Chat and Workflow Run
// pages via CDP.
//
// Run manually:
//   cd agent-tests
//   node right-pane-desktop-smoke.mjs
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
  console.log(`[right-pane] ${ok ? 'PASS' : 'FAIL'} — ${name}${info ? ' :: ' + info : ''}`);
};
const log = (...a) => console.log('[right-pane]', ...a);

// Enable the Chromium remote-debugging endpoint so we can attach.
const DEBUG_PORT = 9223;

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

// Give Electron a moment to open the debug port + load the URL.
const deadline = Date.now() + 30_000;
let browser = null;
while (Date.now() < deadline && !browser) {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  } catch { /* not ready yet */ }
  if (!browser) await new Promise((r) => setTimeout(r, 400));
}
if (!browser) {
  record('electron attach', false, 'timeout waiting for debug endpoint');
  await finish(1);
}
record('electron attach', true);

const contexts = browser.contexts();
const context = contexts[0] ?? await browser.newContext();
let page = null;
// Wait for renderer window
for (let i = 0; i < 60 && !page; i++) {
  const p = context.pages().find((p) => p.url().startsWith('http'));
  if (p) page = p;
  else await new Promise((r) => setTimeout(r, 500));
}
if (!page) {
  record('renderer page found', false);
  await finish(1);
}
record('renderer page found', true, page.url());

// Clear any prior RightPane state so the test starts from a clean slate.
await page.evaluate(() => {
  for (const k of Object.keys(window.localStorage)) {
    if (k.startsWith('generatorai:rightPane:')) window.localStorage.removeItem(k);
  }
});

async function navigateSpa(pathname) {
  // In Electron `page.goto` sometimes races with the shell's will-navigate
  // guard; use client-side SPA navigation via history.pushState + a
  // popstate event so React Router picks it up.
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, pathname);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
}

async function findFirst(kind, listPath) {
  const items = await page.evaluate(async (p) => {
    const res = await fetch(p);
    if (!res.ok) return null;
    return await res.json();
  }, listPath);
  if (!items || !Array.isArray(items) || items.length === 0) return null;
  return items[0];
}

// ── 1. Chat page — Side pane toggle → Changes tab default → Add Browser ──
try {
  const chat = await findFirst('chat', '/api/chats');
  if (!chat) throw new Error('no chat available');
  await navigateSpa(`/chats/${chat.id}`);
  await page.waitForSelector('[data-testid="chat-toggle-right-pane"], [data-testid="chat-toggle-right-pane-banner"]', { timeout: 15_000 });
  const toggle = await page.$('[data-testid="chat-toggle-right-pane"]') ?? await page.$('[data-testid="chat-toggle-right-pane-banner"]');
  await toggle.click();
  await page.waitForSelector('[data-testid="right-pane"]', { timeout: 5_000 });
  record('chat: right pane opens', true);

  await page.waitForSelector('[data-testid="right-pane-tab-changes"]', { timeout: 3_000 });
  record('chat: Changes tab visible by default', true);

  const addBtn = await page.$('[data-testid="right-pane-add-tab"]');
  await addBtn.click();
  const addBrowser = await page.$('[data-testid="right-pane-add-browser"]');
  if (!addBrowser) throw new Error('Browser tab option missing');
  const disabled = await addBrowser.isDisabled();
  if (disabled) {
    record('chat: Browser tab option present (disabled — no workspace yet)', true);
  } else {
    await addBrowser.click();
    await page.waitForSelector('[data-testid="right-pane-tab-browser"]', { timeout: 3_000 });
    record('chat: Browser tab added via + menu', true);
  }
} catch (e) {
  record('chat right pane flow', false, String(e).slice(0, 160));
}

// ── 2. Workflow Run page — Side pane toggle → Add Inspector tab ──
try {
  const run = await findFirst('run', '/api/workflow-runs?limit=1');
  if (!run) throw new Error('no run available');
  await navigateSpa(`/workflows/${run.workflowDefinitionId}/runs/${run.id}`);
  // Wait for the run page's breadcrumb / header before clicking Side pane
  await page.waitForSelector('nav[aria-label="Breadcrumb"]', { timeout: 15_000 });
  await page.waitForSelector('button:has-text("Side pane")', { timeout: 15_000 });
  await page.click('button:has-text("Side pane")');
  await page.waitForSelector('[data-testid="right-pane"]', { timeout: 10_000 });
  record('workflow: right pane opens', true);

  await page.waitForSelector('[data-testid="right-pane-tab-changes"]', { timeout: 3_000 });
  record('workflow: Changes tab visible by default', true);

  await (await page.$('[data-testid="right-pane-add-tab"]')).click();
  const addInspector = await page.$('[data-testid="right-pane-add-inspector"]');
  if (!addInspector) throw new Error('Inspector option missing');
  await addInspector.click();
  await page.waitForSelector('[data-testid="right-pane-tab-inspector"]', { timeout: 3_000 });
  record('workflow: Inspector tab added via + menu', true);

  // Close the Inspector tab and confirm Changes remains.
  await page.click('button[aria-label="Close Inspector tab"]');
  const still = await page.$('[data-testid="right-pane-tab-changes"]');
  if (!still) throw new Error('Changes tab disappeared after close');
  record('workflow: closing Inspector keeps Changes', true);
} catch (e) {
  record('workflow right pane flow', false, String(e).slice(0, 200));
}

await finish(0);

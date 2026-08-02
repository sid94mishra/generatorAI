// Desktop E2E test for Phase 2 built-in browser tools.
//
// Launches the Electron dev shell with a CDP debug port, attaches
// Playwright to it, navigates to a chat we create up-front with
// visibility=visible + evalAllowed=true, and validates that:
//   1) the right pane auto-opens with the Browser tab active
//   2) a natural-language prompt lands and the agent uses the
//      built-in browser tools + run_playwright_code
//   3) a screenshot artifact is produced
//
// Requires:
//   • API server on :3100
//   • Vite dev server on :5173

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';

const DESKTOP = path.resolve(process.cwd(), 'apps', 'desktop');
const requireFromDesktop = createRequire(path.join(DESKTOP, 'package.json'));
const ELECTRON = requireFromDesktop('electron');
const API = process.env.API || 'http://localhost:3100';
const DEBUG_PORT = 9224;

const log = (...a) => console.log('[desktop-p2]', ...a);
const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`[desktop-p2] ${ok ? 'PASS' : 'FAIL'} — ${name}${info ? ' :: ' + info : ''}`);
};

async function apiJson(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  // 1. Create a fresh chat with visibility=visible + evalAllowed=true
  log('creating chat...');
  const chat = await apiJson('/api/chats', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Desktop P2 test',
      description: 'Auto-open Browser tab + run_playwright_code',
      model: 'claude-sonnet-4.6',
      projectId: 'eca0e9a1-3fce-430d-b823-11a58a745807',
      tags: ['e2e', 'desktop-p2'],
      harnessConfig: { availableTools: ['*'], streaming: true },
      browserConfig: {
        enabled: true,
        visibility: 'visible',
        evalAllowed: true,
        allowedHosts: ['playwright.dev', '*.playwright.dev', 'example.com'],
      },
    }),
  });
  record('create chat', !!chat.id, `chat=${chat.id} workspace=${chat.workspaceId}`);

  // Wait a beat for BrowserService.ensureStarted to complete
  await new Promise((r) => setTimeout(r, 3000));
  const desc = await apiJson(`/api/workspaces/${chat.workspaceId}/browser/descriptor`);
  record(
    'browser auto-started (visibility=visible)',
    desc.status === 'active' && desc.ready === true,
    `status=${desc.status} ready=${desc.ready} visibility=${desc.config?.visibility}`,
  );

  // 2. Launch Electron with CDP debug port
  log('launching Electron...');
  const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: DESKTOP,
    env: {
      ...process.env,
      DESKTOP_DEV_SERVER_URL: 'http://localhost:5173',
      GENERATORAI_LOG_LEVEL: 'info',
    },
  });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});

  const teardown = async () => {
    try { child.kill(); } catch {}
  };

  // 3. Attach Playwright to the Electron debug port
  const deadline = Date.now() + 30_000;
  let browser = null;
  while (Date.now() < deadline && !browser) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`); }
    catch { await new Promise((r) => setTimeout(r, 400)); }
  }
  if (!browser) { record('electron attach', false, 'timeout'); await teardown(); process.exit(1); }
  record('electron attach', true);

  const contexts = browser.contexts();
  const context = contexts[0] ?? await browser.newContext();
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    const p = context.pages().find((p) => p.url().startsWith('http'));
    if (p) page = p; else await new Promise((r) => setTimeout(r, 500));
  }
  if (!page) { record('renderer window', false); await teardown(); process.exit(1); }
  record('renderer window', true, page.url());

  // 4. Clear localStorage + navigate to the chat via SPA history
  await page.evaluate(() => {
    Object.keys(window.localStorage).filter((k) => k.startsWith('generatorai:rightPane')).forEach((k) => window.localStorage.removeItem(k));
  }).catch(() => {});
  await page.evaluate((chatId) => {
    window.history.pushState({}, '', '/chats/' + chatId);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, chat.id);
  await page.waitForTimeout(4500);

  // 5. Verify right pane auto-opened with Browser tab
  const paneCount = await page.locator('[data-testid="right-pane"]').count();
  const activeTab = await page
    .locator('[data-testid^="right-pane-tab-"][aria-selected="true"]')
    .textContent().catch(() => '?');
  record(
    'right pane auto-opened',
    paneCount === 1 && (activeTab ?? '').includes('Browser'),
    `paneCount=${paneCount} activeTab=${activeTab}`,
  );

  await page.screenshot({
    path: path.resolve('agent-tests', 'snapshots', 'p2-desktop-01-auto-open.png'),
  });

  // 6. Send a natural prompt via API
  log('sending prompt...');
  const form = new FormData();
  form.append(
    'prompt',
    'Open https://playwright.dev, take a snapshot, then use run_playwright_code to fetch document.title via page.evaluate. Report the title.',
  );
  const promptResp = await fetch(`${API}/api/chats/${chat.id}/prompt`, {
    method: 'POST',
    body: form,
  });
  record('prompt submit', promptResp.ok, `status=${promptResp.status}`);

  // 7. Wait for response completion
  log('waiting for LLM response...');
  try {
    await page.waitForFunction(
      () => /Generating|Copilot is thinking|Processing/.test(document.body.innerText || ''),
      null,
      { timeout: 30_000 },
    );
    await page.waitForFunction(
      () => !/Generating response|Copilot is thinking|Processing/.test(document.body.innerText || ''),
      null,
      { timeout: 300_000 },
    );
  } catch { /* fall through */ }
  await page.waitForTimeout(2500);

  const mainText = await page.locator('main').innerText().catch(() => '');
  const toolsSeen = /open_browser_page.*Done/i.test(mainText) && /run_playwright_code.*Done/i.test(mainText);
  const titleReported = /Fast and reliable|end-to-end testing|Playwright/i.test(mainText);
  record('tools invoked', toolsSeen);
  record('page title extracted', titleReported);

  await page.screenshot({
    path: path.resolve('agent-tests', 'snapshots', 'p2-desktop-02-completed.png'),
    fullPage: true,
  });

  // 8. Check snapshot artifact appeared
  const snapshots = await apiJson(`/api/workspaces/${chat.workspaceId}/browser/snapshots`);
  const hasScreenshot = snapshots.artifacts?.some((a) => a.artifactType === 'browser_screenshot');
  record('screenshot artifact', hasScreenshot, `count=${snapshots.artifacts?.length ?? 0}`);

  // 9. Report
  const fails = results.filter((r) => !r.ok);
  console.log('\n=== summary ===');
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.info ? ' — ' + r.info : ''}`);
  await teardown();
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[desktop-p2] fatal', err);
  process.exit(1);
});

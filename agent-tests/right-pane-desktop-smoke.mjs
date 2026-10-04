// Focused smoke test for the dock (historical `right-pane*` ids, 09 §7.2).
//
// Launches the built Electron shell standalone (embedded server, isolated
// profile) and drives the dock on the Chat and Workflow Run pages.
//
// Run from the repo root after `pnpm --filter @generatorai/desktop build`:
//   node agent-tests/right-pane-desktop-smoke.mjs

import { _electron as electron } from 'playwright';
import { DESKTOP_DIR as DESKTOP, isolatedProfile } from './helpers/desktop-profile.mjs';


const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`[right-pane] ${ok ? 'PASS' : 'FAIL'} — ${name}${info ? ' :: ' + info : ''}`);
};
const log = (...a) => console.log('[right-pane]', ...a);

// Launch through Playwright's Electron driver with a throwaway profile and the
// built renderer on the embedded server (standalone): no dev server, no
// developer profile, no :3100/:5173 (09 §6.5, agent-tests/helpers/desktop-profile.mjs).
const profile = isolatedProfile('gai-right-pane-smoke-');
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
record('renderer page found', true, page.url());
// The SPA pairs with the embedded server before its first API call; wait for
// the app frame so the smoke's own fetches go out paired.
await page.getByTestId('app-frame').waitFor({ timeout: 60_000 });

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
  const page_ = await page.evaluate(async (p) => {
    const res = await fetch(p);
    if (!res.ok) return null;
    return await res.json();
  }, listPath);
  // `/api/chats` answers a page (`{ items, ... }`), not a bare array.
  const items = Array.isArray(page_) ? page_ : page_?.items;
  if (!items || !Array.isArray(items) || items.length === 0) return null;
  return items[0];
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

/** A published one-stage workflow and one run of it (Faux harness). */
async function createRun() {
  const def = await apiPost('/api/workflow-definitions', {
    formatVersion: 2,
    workflow: { name: `right-pane-smoke ${Date.now()}` },
    stages: [{ key: 'only', name: 'Only', kind: 'agent', prompts: [{ label: 'P', text: 'Reply with DONE.' }] }],
    edges: [],
  });
  await apiPost(`/api/workflow-definitions/${def.id}/publish`, {});
  const inv = await apiPost('/api/workflow-invocations', { target: { kind: 'definition', workflowDefinitionId: def.id }, variables: {}, client: 'http' });
  return { id: inv.runId, workflowDefinitionId: def.id };
}

// ── 1. Chat page — Side pane toggle → Changes tab default → Add Browser ──
try {
  const chat = (await findFirst('chat', '/api/chats')) ?? (await createChat(`right-pane-smoke ${Date.now()}`));
  await navigateSpa(`/chats/${chat.id}`);
  // The dock toggle lives in the chat's own page header since P4-12
  // (`dock-toggle`; the run page's legacy header uses the same testid). It
  // keeps the accessible name "Show side pane" / "Hide side pane".
  await page.waitForSelector('[data-testid="dock-toggle"]', { timeout: 15_000 });
  const toggle = await page.$('[data-testid="dock-toggle"]');
  await toggle.click();
  await page.waitForSelector('[data-testid="right-pane"]', { timeout: 5_000 });
  record('chat: right pane opens', true);

  await page.waitForSelector('[data-testid="right-pane-tab-changes"]', { timeout: 3_000 });
  record('chat: Changes tab visible by default', true);

  if (await page.$('[data-testid="right-pane-tab-browser"]')) {
    // Browser is a pinned chat dock tab (D-65): already in the strip, not in "+".
    record('chat: Browser tab present (pinned)', true);
  } else {
  const addBtn = await page.$('[data-testid="right-pane-add-tab"]');
  await addBtn.click();
  // The "+" menu renders on the next frame.
  const addBrowser = await page.waitForSelector('[data-testid="right-pane-add-browser"]', { timeout: 3_000 }).catch(() => null);
  if (!addBrowser) throw new Error('Browser tab option missing');
  const disabled = await addBrowser.isDisabled();
  if (disabled) {
    record('chat: Browser tab option present (disabled — no workspace yet)', true);
  } else {
    await addBrowser.click();
    await page.waitForSelector('[data-testid="right-pane-tab-browser"]', { timeout: 3_000 });
    record('chat: Browser tab added via + menu', true);
  }
  }
} catch (e) {
  record('chat right pane flow', false, String(e).slice(0, 160));
}

// ── 2. Workflow Run page — Side pane toggle → Add Usage tab ──
try {
  const run = (await findFirst('run', '/api/workflow-runs?limit=1')) ?? (await createRun());
  await navigateSpa(`/workflows/${run.workflowDefinitionId}/runs/${run.id}`);
  // The run page renders its own RunHeader (PW-c): breadcrumb + the kit dock
  // toggle, which drives the blocks/dock Dock (same `right-pane*` ids).
  // Scoped to the run workspace: on a first launch the run route's chunk is
  // still loading when the URL changes, so the chat page (its own breadcrumb
  // and dock-toggle) stays on screen meanwhile — an unscoped click closed the
  // CHAT's dock and the run page then mounted with its dock closed.
  const runToggle = '[data-testid="run-workspace"] [data-testid="dock-toggle"]';
  await page.waitForSelector(runToggle, { timeout: 15_000 });
  if ((await page.getAttribute(runToggle, 'aria-pressed')) !== 'true') await page.click(runToggle);
  await page.waitForSelector('[data-testid="run-workspace"] [data-testid="right-pane"]', { timeout: 10_000 });
  record('workflow: right pane opens', true);

  // Inspector and Changes are pinned run tabs (board WorkflowRun).
  await page.waitForSelector('[data-testid="right-pane-tab-inspector"]', { timeout: 3_000 });
  await page.waitForSelector('[data-testid="right-pane-tab-changes"]', { timeout: 3_000 });
  record('workflow: Inspector and Changes tabs visible by default', true);

  await (await page.$('[data-testid="right-pane-add-tab"]')).click();
  const addUsage = await page.waitForSelector('[data-testid="right-pane-add-usage"]', { timeout: 3_000 }).catch(() => null);
  if (!addUsage) throw new Error('Usage option missing');
  await addUsage.click();
  await page.waitForSelector('[data-testid="right-pane-tab-usage"]', { timeout: 3_000 });
  record('workflow: Usage tab added via + menu', true);

  // Close the Usage tab and confirm Changes remains.
  await page.click('button[aria-label="Close Usage tab"]');
  const still = await page.$('[data-testid="right-pane-tab-changes"]');
  if (!still) throw new Error('Changes tab disappeared after close');
  record('workflow: closing Usage keeps Changes', true);
} catch (e) {
  record('workflow right pane flow', false, String(e).slice(0, 200));
}

await finish(0);

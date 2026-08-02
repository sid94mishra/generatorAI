// Focused desktop check: does the Pierre diff viewer actually render inside the
// PRODUCTION Vite bundle that the desktop app serves?
//
// Split out from desktop-diff-review-smoke.mjs because that test reported an
// empty result, which is ambiguous: it could mean the worker/renderer failed,
// or simply that the Changes panel was never opened. This drives the UI
// explicitly and dumps what is on screen so the two cases are distinguishable.

import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

const DESKTOP = path.resolve(process.cwd(), '..', 'apps', 'desktop');
const requireFromDesktop = createRequire(path.join(DESKTOP, 'package.json'));
const ELECTRON = requireFromDesktop('electron');

const app = await electron.launch({
  executablePath: ELECTRON,
  args: ['.'],
  cwd: DESKTOP,
  env: { ...process.env, GENERATORAI_DESKTOP_MODE: 'standalone' },
  timeout: 60000,
});

let page = null;
const deadline = Date.now() + 90000;
while (Date.now() < deadline && !page) {
  const candidate = app.windows().find((p) => !p.url().startsWith('file:'));
  if (candidate) page = candidate;
  else await new Promise((r) => setTimeout(r, 1000));
}
await page.waitForLoadState('domcontentloaded');
const base = new URL(page.url()).origin;
console.log('[render] base', base);

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300));
});
// A failed worker fetch is the most likely prod-only breakage.
page.on('requestfailed', (r) => {
  if (r.url().includes('worker') || r.url().includes('assets')) {
    errors.push(`requestfailed: ${r.url().slice(-60)} ${r.failure()?.errorText}`);
  }
});

const api = async (p, init) =>
  page.evaluate(
    async ([url, opts]) => {
      const r = await fetch(url, opts ?? undefined);
      return { status: r.status, body: await r.text() };
    },
    [base + p, init ?? null],
  );

// Reuse an existing chat that already has changes, else make one.
const chatsRes = await api('/api/chats');
const chats = JSON.parse(chatsRes.body);
const list = Array.isArray(chats) ? chats : (chats.chats ?? []);
let target = null;
for (const c of list) {
  if (!c.workspaceId) continue;
  const s = await api(`/api/workspaces/${c.workspaceId}/changes?base=baseline&head=working`);
  if (s.status !== 200) continue;
  const sum = JSON.parse(s.body);
  const n = (sum.repos ?? []).reduce((acc, r) => acc + r.files.length, 0);
  if (n > 0) { target = { chat: c, files: n }; break; }
}

if (!target) {
  console.log('[render] FAIL — no chat with changes available to render');
  await app.close();
  process.exit(1);
}
console.log(`[render] using chat ${target.chat.id} (${target.files} changed files)`);

await page.goto(`${base}/chats/${target.chat.id}`);
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(8000);

// Open the Changes surface. On the chat page it lives in the RIGHT PANE,
// which is collapsed by default — so the "Show side pane" toggle must be
// clicked first, otherwise there is no Changes tab in the DOM at all.
const showPane = page.getByRole('button', { name: /Show side pane/i }).first();
if (await showPane.count()) {
  await showPane.click().catch(() => {});
  await page.waitForTimeout(3000);
}

const tabNames = await page.getByRole('button').allInnerTexts().catch(() => []);
const changes = page.getByRole('button', { name: /^Changes/ }).first();
if (await changes.count()) {
  await changes.click().catch(() => {});
} else {
  console.log('[render] no Changes button; buttons =', JSON.stringify(tabNames.slice(0, 25)));
}
await page.waitForTimeout(10000);

// Files render COLLAPSED by default (bodies are fetched lazily), so a mounted
// host with no <pre><code> only means "not expanded yet" — it is not evidence
// that the renderer failed. Expand everything before asserting.
const expandAll = page.getByRole('button', { name: /^Expand all$/ }).first();
if (await expandAll.count()) {
  await expandAll.click().catch(() => {});
  await page.waitForTimeout(10000);
} else {
  // Fall back to clicking the first file row.
  const firstFile = page.locator('button').filter({ hasText: /\.(py|md|ts|js|json|txt)$/ }).first();
  if (await firstFile.count()) {
    await firstFile.click().catch(() => {});
    await page.waitForTimeout(8000);
  }
}

const state = await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('diffs-container')];
  return {
    hostCount: hosts.length,
    shadowRoots: hosts.filter((h) => !!h.shadowRoot).length,
    codeTexts: hosts.map((h) => {
      const c = h.shadowRoot?.querySelector('pre code');
      return c ? c.textContent.replace(/\s+/g, ' ').slice(0, 120) : '(no code el)';
    }),
    bodyHasNoChanges: document.body.innerText.includes('No changes detected'),
  };
});

console.log('[render] state =', JSON.stringify(state, null, 1));
console.log('[render] errors =', JSON.stringify(errors.slice(0, 5), null, 1));

const ok = state.hostCount > 0 && state.codeTexts.some((t) => t !== '(no code el)' && t.length > 5);
console.log(`[render] ${ok ? 'PASS' : 'FAIL'} — diff viewer renders in the desktop production bundle`);

await page.screenshot({ path: path.join(process.env.TEMP || '.', 'desktop-diff-render.png') });
await app.close();
process.exit(ok ? 0 : 1);

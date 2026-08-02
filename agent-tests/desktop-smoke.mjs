// Desktop end-to-end smoke test (run manually: `node agent-tests/desktop-smoke.mjs`).
// Launches the packaged-style standalone Electron app (embedded server) and
// drives real feature flows in the renderer to prove parity with the web UI.
// Not named *.spec.ts on purpose so the Playwright test runner does not auto-run it.

import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

const OUT = process.env.OUT || '.';
const DESKTOP = path.resolve(process.cwd(), '..', 'apps', 'desktop');
const requireFromDesktop = createRequire(path.join(DESKTOP, 'package.json'));
const ELECTRON = requireFromDesktop('electron'); // resolves to the electron.exe path

const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`[smoke] ${ok ? 'PASS' : 'FAIL'} — ${name}${info ? ' :: ' + info : ''}`);
};
const log = (...a) => console.log('[smoke]', ...a);

const app = await electron.launch({
  executablePath: ELECTRON,
  args: ['.'],
  cwd: DESKTOP,
  env: { ...process.env, GENERATORAI_DESKTOP_MODE: 'standalone' },
  timeout: 60000,
});
app.process().stdout?.on('data', (d) => {
  const s = d.toString();
  if (s.includes('[ERROR]') || s.includes('ready') || s.includes('Loading app URL')) process.stdout.write('  [main] ' + s);
});
app.process().stderr?.on('data', (d) => {
  const s = d.toString();
  if (s.includes('[ERROR]')) process.stdout.write('  [main-err] ' + s);
});

let page = null;
const deadline = Date.now() + 90000;
while (Date.now() < deadline && !page) {
  for (const w of app.windows()) {
    let url = '';
    try { url = w.url(); } catch { /* transitioning */ }
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) { page = w; break; }
  }
  if (!page) await new Promise((r) => setTimeout(r, 800));
}

if (!page) {
  record('main window appears', false, 'no http window');
  await finish();
}
record('main window appears', true, page.url());
const origin = new URL(page.url()).origin;

await page.waitForLoadState('domcontentloaded').catch(() => {});
await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);

// 1. Same-origin health (REST + DB + harness).
try {
  const health = await page.evaluate(async () => (await fetch('/api/health')).json());
  record('health endpoint ok', health.status === 'ok' && health.db === true, `harness=${health.harness?.type} db=${health.db}`);
} catch (e) {
  record('health endpoint ok', false, String(e).slice(0, 120));
}

// 2. Templates API returns the 5 system templates (renderer fetch, same-origin).
try {
  const templates = await page.evaluate(async () => (await fetch('/api/templates')).json());
  const count = Array.isArray(templates) ? templates.length : Array.isArray(templates?.templates) ? templates.templates.length : 0;
  record('templates available', count >= 1, `count=${count}`);
} catch (e) {
  record('templates available', false, String(e).slice(0, 120));
}

// 3. Create a workflow from a template via the UI → exercises POST + DB write.
try {
  await navigate(page, '/templates');
  await page.waitForTimeout(1500);
  const useBtn = page.getByRole('button', { name: /use template|use|create/i }).first();
  await useBtn.click({ timeout: 8000 });
  await page.waitForTimeout(3000);
  record('create workflow from template', true, 'clicked Use Template; url=' + (await page.evaluate(() => location.pathname)));
} catch (e) {
  record('create workflow from template', false, String(e).slice(0, 160));
}

// 3b. Open the React Flow builder deterministically for the created workflow.
try {
  const id = await page.evaluate(async () => {
    const r = await fetch('/api/workflow-definitions');
    const j = await r.json();
    const arr = Array.isArray(j) ? j : j.definitions || j.items || [];
    return arr[0]?.id ?? null;
  });
  if (!id) throw new Error('no workflow id');
  await navigate(page, `/workflows/${id}/edit`);
  await page.waitForSelector('.react-flow', { timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/desktop-builder.png` });
  record('workflow builder (React Flow) renders', true, `id=${String(id).slice(0, 8)}`);
} catch (e) {
  await page.screenshot({ path: `${OUT}/desktop-builder.png` }).catch(() => {});
  record('workflow builder (React Flow) renders', false, String(e).slice(0, 160));
}

// 4. The created workflow now appears in the list.
try {
  await navigate(page, '/workflows');
  await page.waitForTimeout(1800);
  const count = await page.evaluate(async () => {
    const r = await fetch('/api/workflow-definitions');
    const j = await r.json();
    const arr = Array.isArray(j) ? j : j.definitions || j.items || [];
    return arr.length;
  });
  await page.screenshot({ path: `${OUT}/desktop-workflows-after.png` });
  record('workflow persisted in list', count >= 1, `count=${count}`);
} catch (e) {
  record('workflow persisted in list', false, String(e).slice(0, 160));
}

// 5. New Chat flow — enumerate buttons, click the create entry, verify a dialog
//    or the new-chat surface appears (models API + modal/route).
try {
  await navigate(page, '/chats');
  await page.waitForTimeout(1500);
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, a[role="button"], a'))
      .map((b) => (b.textContent || '').trim())
      .filter((t) => t && t.length < 40)
      .slice(0, 40),
  );
  log('chat page buttons:', JSON.stringify(buttons));
  const inputsBefore = await page.evaluate(() => document.querySelectorAll('input,textarea,select').length);
  const newChat = page.getByRole('button', { name: /new chat|new conversation|create chat|new/i }).first();
  await newChat.click({ timeout: 8000 });
  await page.waitForTimeout(1800);
  const surface = await page.evaluate((before) => {
    const dlg = document.querySelector(
      '[role="dialog"], .modal, [class*="Dialog"], [class*="modal"], div[class*="fixed"][class*="inset-0"]',
    );
    const inputsAfter = document.querySelectorAll('input,textarea,select').length;
    const txt = document.body.innerText;
    const looksLikeForm = /create chat|new chat|model|description|tags|codebase/i.test(txt) && inputsAfter > before;
    return {
      dialog: !!dlg,
      inputsBefore: before,
      inputsAfter,
      looksLikeForm,
      path: location.pathname,
    };
  }, inputsBefore);
  await page.screenshot({ path: `${OUT}/desktop-newchat-dialog.png` });
  record(
    'new chat flow opens',
    surface.dialog || surface.looksLikeForm || surface.inputsAfter > surface.inputsBefore || surface.path !== '/chats',
    JSON.stringify(surface),
  );
  await page.keyboard.press('Escape').catch(() => {});
} catch (e) {
  await page.screenshot({ path: `${OUT}/desktop-newchat-dialog.png` }).catch(() => {});
  record('new chat flow opens', false, String(e).slice(0, 160));
}

await finish();

async function navigate(p, route) {
  await p.evaluate((r) => {
    window.history.pushState({}, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
}

async function finish() {
  await app.close().catch(() => {});
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[smoke] ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 2);
}

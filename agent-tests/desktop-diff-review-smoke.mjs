// Desktop verification for the diff / review / checkpoint work.
// Launches the standalone Electron app against its embedded server and drives
// the SAME surfaces that were validated in the browser, because the desktop
// renderer is a PRODUCTION Vite bundle — worker loading and shadow-DOM
// rendering can behave differently there than under the dev server.
//
// Run manually: `node agent-tests/desktop-diff-review-smoke.mjs`

import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

const DESKTOP = path.resolve(process.cwd(), '..', 'apps', 'desktop');
const requireFromDesktop = createRequire(path.join(DESKTOP, 'package.json'));
const ELECTRON = requireFromDesktop('electron');

const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`[diff-smoke] ${ok ? 'PASS' : 'FAIL'} — ${name}${info ? ' :: ' + info : ''}`);
};

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
  const w = app.windows();
  const candidate = w.find((p) => !p.url().startsWith('file:'));
  if (candidate) page = candidate;
  else await new Promise((r) => setTimeout(r, 1000));
}
if (!page) {
  console.error('[diff-smoke] no renderer window');
  await app.close();
  process.exit(1);
}
await page.waitForLoadState('domcontentloaded');
const base = new URL(page.url()).origin;
record('renderer window', true, base);

// Surface any renderer-side errors: a failed worker load shows up here first.
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(m.text().slice(0, 200));
});

const api = async (p, init) => {
  const res = await page.evaluate(
    async ([url, opts]) => {
      const r = await fetch(url, opts ?? undefined);
      return { status: r.status, body: await r.text() };
    },
    [base + p, init ?? null],
  );
  return res;
};

// ── 1. Create a chat with a workspace and have the agent write a file ──
const created = await api('/api/chats', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Desktop Diff Smoke',
    model: 'claude-sonnet-4.6',
    createWorktree: true,
  }),
});
const chat = JSON.parse(created.body);
record('chat with workspace created', !!chat.workspaceId, `ws=${chat.workspaceId}`);

await api(`/api/chats/${chat.id}/prompt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Create greet.py with a function hello(name) that returns a greeting. Only create the file.',
  }),
});

// Wait for the turn to land a checkpoint.
let checkpoints = [];
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const res = await api(`/api/workspaces/${chat.workspaceId}/checkpoints`);
  checkpoints = JSON.parse(res.body).checkpoints ?? [];
  if (checkpoints.some((c) => c.phase === 'after')) break;
}
record(
  'checkpoints captured (baseline + after)',
  checkpoints.some((c) => c.kind === 'baseline') && checkpoints.some((c) => c.phase === 'after'),
  checkpoints.map((c) => `${c.kind}/${c.phase ?? '-'}`).join(','),
);

// ── 2. Changes API v2 returns a summary ──
const sumRes = await api(`/api/workspaces/${chat.workspaceId}/changes?base=baseline&head=working`);
const summary = JSON.parse(sumRes.body);
const files = (summary.repos ?? []).flatMap((r) => r.files.map((f) => f.path));
record('change summary lists the new file', files.length > 0, files.join(','));

// ── 3. Diff renders in the PRODUCTION bundle (workers + shadow DOM) ──
await page.goto(`${base}/chats/${chat.id}`);
await page.waitForTimeout(6000);
// The Changes surface lives in the RIGHT PANE, collapsed by default.
const showPane = page.getByRole('button', { name: /Show side pane/i }).first();
if (await showPane.count()) {
  await showPane.click().catch(() => {});
  await page.waitForTimeout(2500);
}
const changesTab = page.getByRole('button', { name: /^Changes/ }).first();
await changesTab.click().catch(() => {});
await page.waitForTimeout(5000);
// Files start collapsed (bodies are lazy), so expand before asserting —
// otherwise a mounted-but-empty host reads as a render failure.
const expandAll = page.getByRole('button', { name: /^Expand all$/ }).first();
if (await expandAll.count()) {
  await expandAll.click().catch(() => {});
  await page.waitForTimeout(8000);
}

const rendered = await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('diffs-container')];
  return hosts.map((h) => {
    const code = h.shadowRoot?.querySelector('pre code');
    return code ? code.textContent.replace(/\s+/g, ' ').slice(0, 120) : '(empty)';
  });
});
record(
  'diff viewer renders code (workers OK in prod bundle)',
  rendered.some((t) => t !== '(empty)' && t.length > 5),
  JSON.stringify(rendered).slice(0, 160),
);

// ── 4. Review thread round-trip through the API ──
const target = files[0] ?? 'greet.py';
const fileRes = await api(
  `/api/workspaces/${chat.workspaceId}/changes/file?path=${encodeURIComponent(target)}&alias=.&form=versions&base=baseline&head=working`,
);
const versions = JSON.parse(fileRes.body);
const firstLine = (versions.new?.contents ?? '').split('\n')[0] ?? '';

const threadRes = await api(`/api/workspaces/${chat.workspaceId}/review/threads`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    scope: 'chat',
    scopeId: chat.id,
    path: target,
    alias: '.',
    side: 'additions',
    startLine: 1,
    endLine: 1,
    anchorText: firstLine,
    body: 'Add a type hint to name.',
    intent: 'fix',
  }),
});
const thread = threadRes.status === 201 ? JSON.parse(threadRes.body) : null;
record('review thread created', !!thread?.id, `status=${threadRes.status} ${thread?.status ?? ''}`);

// ── 5. Batch prompt serialization ──
if (thread) {
  const preview = await api(`/api/workspaces/${chat.workspaceId}/review/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threadIds: [thread.id],
      target: { kind: 'chat', chatId: chat.id },
      preview: true,
    }),
  });
  const p = JSON.parse(preview.body);
  record(
    'review batch prompt renders',
    typeof p.prompt === 'string' && p.prompt.includes('<review_feedback'),
    (p.prompt ?? '').slice(0, 80).replace(/\n/g, ' '),
  );
}

// ── 6. Checkpoint restore (rewind) ──
const baseline = checkpoints.find((c) => c.kind === 'baseline');
if (baseline) {
  const restore = await api(
    `/api/workspaces/${chat.workspaceId}/checkpoints/${baseline.id}/restore`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );
  const r = JSON.parse(restore.body);
  record(
    'rewind to baseline works',
    restore.status === 200 && !!r.preRestoreCheckpointId,
    `deleted=${(r.deletedPaths ?? []).length} restored=${(r.restoredPaths ?? []).length}`,
  );
}

record('no renderer errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

const passed = results.filter((r) => r.ok).length;
console.log(`\n[diff-smoke] ${passed}/${results.length} checks passed`);
await app.close();
process.exit(passed === results.length ? 0 : 1);

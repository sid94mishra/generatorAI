// ────────────────────────────────────────────────────────────────
// Desktop dock × native browser smoke (P4-06; 06-desktop-and-shell.md §4.5,
// 09 §6.5). Drives the real Electron app (`_electron.launch`, isolated
// `--user-data-dir`, GENERATORAI_DESKTOP_NATIVE_BROWSER=1) and reads the native
// `WebContentsView`s' visibility and bounds in MAIN (`app.evaluate`), so it
// checks what the user actually sees, not what the renderer believes.
//
// Cases (06 §4.5):
//   1. The Browser dock tab at 1440×900 shows its native view.
//   2. Opening the dock "+" menu hides it; Esc shows it again.
//   3. Mod+K (palette) hides it; closing the palette shows it.
//   4. Resizing the window to 1100×760 gives `dock-sheet`, the view stays
//      visible with bounds inside the sheet, and no `destroyed tab=` is logged
//      (one stable React tree across 1200px, D-27).
//   5. Maximize (`right-pane-fullscreen`) keeps it visible; its width is at
//      least the main card's width minus 2.
//   6. Switching to the Changes tab hides it.
//   7. Collapsing the dock (the "Hide side pane" toggle) hides it; reopening
//      shows the same URL.
// Then a per-overlay loop (D-19): each floating layer that can open over the
// view — the dock "+" menu (pointer and keyboard), the palette, a toast, the
// shortcuts sheet — must hide the view while open and restore it when closed.
//
// Run (repo root, after `pnpm --filter @generatorai/desktop build`):
//   node agent-tests/desktop-dock-browser-smoke.mjs
// Screenshots: agent-tests/test-results/desktop-dock-browser-smoke/.
// Cross-platform: Mod is Meta on macOS and Control elsewhere; paths via path/os.
// ────────────────────────────────────────────────────────────────

import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DESKTOP_DIR, REPO_ROOT, isolatedProfile } from './helpers/desktop-profile.mjs';

const TAG = '[dock-browser-smoke]';
const SHOTS = path.join(REPO_ROOT, 'agent-tests', 'test-results', 'desktop-dock-browser-smoke');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const TEST_URL = 'data:text/html,<title>dock smoke</title><h1 style="font:48px sans-serif">dock smoke page</h1>';

const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${TAG} ${ok ? 'PASS' : 'FAIL'} — ${name}${info ? ' :: ' + info : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await fs.mkdir(SHOTS, { recursive: true });
const profile = isolatedProfile('gai-dock-browser-smoke-');
const mainLog = [];
let app = null;
let page = null;

async function finish() {
  try {
    await Promise.race([app?.close(), sleep(10_000)]);
  } catch {
    /* already gone */
  }
  profile.cleanup();
  const failures = results.filter((r) => !r.ok);
  console.log('\n=== summary ===');
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.info ? ' — ' + r.info : ''}`);
  console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll passed.');
  process.exit(failures.length ? 1 : 0);
}

async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
}

/** Native views of the main window, read in main: `[{ visible, bounds, url }]`. */
async function nativeViews() {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => /^https?:/.test(w.webContents.getURL()));
    if (!win) return [];
    return win.contentView.children
      .filter((v) => v.webContents && v.webContents.id !== win.webContents.id)
      .map((v) => ({
        visible: typeof v.getVisible === 'function' ? v.getVisible() : null,
        bounds: v.getBounds(),
        url: v.webContents.getURL(),
      }));
  });
}

/** The (single) browser view; waits a little for the renderer's 100 ms occlusion poll to settle. */
async function browserView(expectVisible, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const views = await nativeViews();
    last = views.find((v) => v.url.startsWith('data:')) ?? views[0] ?? null;
    if (last && (expectVisible === undefined || last.visible === expectVisible)) return last;
    await sleep(150);
  }
  return last;
}

async function setWindowSize(width, height) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((w) => /^https?:/.test(w.webContents.getURL()));
      win?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await sleep(600);
}

const rectOf = (selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);

/** Runs `open`, expects the view hidden, runs `close`, expects it visible again. */
async function overlayHides(name, open, close) {
  try {
    await open();
    const hidden = await browserView(false);
    await shot(`overlay-${name}`);
    await close();
    const shown = await browserView(true);
    record(`overlay "${name}" hides the view while open`, hidden?.visible === false, JSON.stringify(hidden));
    record(`overlay "${name}" shows it again when closed`, shown?.visible === true, JSON.stringify(shown));
  } catch (e) {
    record(`overlay "${name}"`, false, String(e).slice(0, 200));
  }
}

// ── Launch ─────────────────────────────────────────────────────
try {
  app = await electron.launch({
    args: ['.', profile.arg],
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      GENERATORAI_DESKTOP_MODE: 'standalone',
      GENERATORAI_DESKTOP_NATIVE_BROWSER: '1',
      GENERATORAI_LOG_LEVEL: 'info',
    },
  });
  profile.attach(app);
  const onOut = (b) => {
    const text = b.toString();
    mainLog.push(text);
    if (/NativeBrowserHost/.test(text)) process.stdout.write(`  [main] ${text}`);
  };
  app.process().stdout.on('data', onOut);
  app.process().stderr.on('data', onOut);
  record('electron launched', true, profile.dir);
} catch (e) {
  record('electron launched', false, String(e).slice(0, 300));
  await finish();
}

const pageDeadline = Date.now() + 90_000;
while (Date.now() < pageDeadline && !page) {
  for (const w of app.windows()) {
    let u = '';
    try {
      u = w.url();
    } catch {
      /* closing */
    }
    if (/^http:\/\/(127\.0\.0\.1|localhost)/.test(u)) page = w;
  }
  if (!page) await sleep(1000);
}
if (!page) {
  record('SPA window appears', false, 'no http window after 90 s');
  await finish();
}
record('SPA window appears', true, page.url());
await page.waitForFunction(() => document.querySelector('#root')?.children.length > 0, { timeout: 30_000 }).catch(() => {});
await setWindowSize(1440, 900);

// ── A chat with a workspace, its dock open on the Browser tab ────
let chatId = null;
let workspaceId = null;
try {
  const created = await page.evaluate(async () => {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `dock-smoke ${Date.now()}` }),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, id: data?.id ?? data?.chat?.id, workspaceId: data?.workspaceId ?? data?.chat?.workspaceId };
  });
  chatId = created.id ?? null;
  workspaceId = created.workspaceId ?? null;
  if (chatId && !workspaceId) {
    workspaceId = await page.evaluate(async (id) => (await (await fetch(`/api/chats/${id}`)).json()).workspaceId ?? null, chatId);
  }
  record('create a chat with a workspace', !!chatId && !!workspaceId, `chat=${chatId} workspace=${workspaceId}`);
} catch (e) {
  record('create a chat with a workspace', false, String(e).slice(0, 200));
}
if (!chatId || !workspaceId) await finish();

try {
  // `?dock=browser` (R-4) opens the dock on the Browser tab.
  await page.evaluate((id) => {
    window.history.pushState({}, '', `/chats/${id}?dock=browser`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, chatId);
  await page.waitForSelector('[data-testid="right-pane"][data-state="open"]', { timeout: 15_000 });
  await page.waitForSelector('[data-testid="right-pane-tab-browser"][aria-selected="true"]', { timeout: 10_000 });
  record('?dock=browser opens the dock on Browser and is consumed', !page.url().includes('dock='), page.url());
  await page.evaluate(async (wid) => {
    await fetch(`/api/workspaces/${wid}/browser/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { enabled: true, visibility: 'visible' } }),
    });
  }, workspaceId);
  await page.waitForSelector('[aria-label="Native browser view"]', { timeout: 20_000 });
  const url = page.locator('[data-testid="browser-url"]');
  await url.fill(TEST_URL);
  await url.press('Enter');
  await sleep(1500);
} catch (e) {
  record('open the Browser tab with a native view', false, String(e).slice(0, 200));
  await finish();
}

// 1. Visible at 1440×900.
{
  const v = await browserView(true, 10_000);
  await shot('1-browser-1440');
  record('1. Browser tab at 1440×900 shows the native view', v?.visible === true && v.bounds.width > 0, JSON.stringify(v));
}

// 2. The dock "+" menu hides it; Esc shows it.
await overlayHides(
  'dock + menu',
  () => page.click('[data-testid="right-pane-add-tab"]'),
  () => page.keyboard.press('Escape'),
);

// 3. The palette (Mod+K) hides it; closing shows it.
await overlayHides(
  'command palette',
  () => page.keyboard.press(`${MOD}+k`),
  () => page.keyboard.press('Escape'),
);

// Per-overlay loop (D-19): the remaining layers that can open over the view.
await overlayHides(
  'toast',
  // A sonner toast is matched through [data-sonner-toast] (06 §4.1); place one where sonner does.
  () =>
    page.evaluate(() => {
      const t = document.createElement('li');
      t.setAttribute('data-sonner-toast', '');
      t.id = 'smoke-toast';
      Object.assign(t.style, { position: 'fixed', right: '16px', bottom: '16px', width: '360px', height: '64px' });
      document.body.append(t);
    }),
  () => page.evaluate(() => document.getElementById('smoke-toast')?.remove()),
);
await overlayHides(
  'dock + menu from the keyboard',
  async () => {
    await page.focus('[data-testid="right-pane-add-tab"]');
    await page.keyboard.press('Enter');
  },
  () => page.keyboard.press('Escape'),
);
await overlayHides(
  'shortcuts sheet (?)',
  async () => {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Shift+/');
  },
  () => page.keyboard.press('Escape'),
);

// 4. Across 1200px: the sheet, the view still visible and inside it, nothing destroyed.
try {
  const destroyedBefore = mainLog.join('').match(/destroyed tab=/g)?.length ?? 0;
  const nodeBefore = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Native browser view"]');
    el?.setAttribute('data-smoke-identity', 'kept');
    return !!el;
  });
  await setWindowSize(1100, 760);
  await page.waitForSelector('[data-testid="dock-sheet"]', { timeout: 5000 });
  const v = await browserView(true);
  const sheet = await rectOf('[data-testid="dock-sheet"]');
  const inside =
    !!v && !!sheet && v.bounds.x >= Math.floor(sheet.x) - 1 && v.bounds.x + v.bounds.width <= Math.ceil(sheet.x + sheet.width) + 1;
  const sameNode = await page.evaluate(
    () => document.querySelector('[aria-label="Native browser view"]')?.getAttribute('data-smoke-identity') === 'kept',
  );
  const destroyedAfter = mainLog.join('').match(/destroyed tab=/g)?.length ?? 0;
  await shot('4-sheet-1100');
  record('4. 1100×760 shows dock-sheet with the view visible inside it', v?.visible === true && inside, JSON.stringify({ v, sheet }));
  record('4. crossing 1200px keeps the same view node (no remount)', nodeBefore && sameNode);
  record('4. crossing 1200px destroys no native view', destroyedAfter === destroyedBefore, `${destroyedBefore} → ${destroyedAfter}`);
  await setWindowSize(1440, 900);
  const back = await browserView(true);
  record('4. back at 1440 the view is visible in the panel', back?.visible === true && (await page.$('[data-testid="dock-sheet"]')) === null);
} catch (e) {
  record('4. crossing 1200px', false, String(e).slice(0, 200));
}

// 5. Maximize keeps it visible and about as wide as the main card.
try {
  await page.click('[data-testid="right-pane-fullscreen"]');
  await sleep(400);
  const v = await browserView(true);
  const card = await rectOf('[data-testid="main-card"]');
  await shot('5-maximized');
  record('5. maximized dock keeps the view visible, width ≥ main card − 2', v?.visible === true && !!card && v.bounds.width >= card.width - 2 - 2, JSON.stringify({ v, card }));
  await page.click('[data-testid="right-pane-fullscreen"]');
  await sleep(300);
} catch (e) {
  record('5. maximize', false, String(e).slice(0, 200));
}

// 6. Changes hides it.
try {
  await page.click('[data-testid="right-pane-tab-changes"]');
  const v = await browserView(false);
  record('6. switching to Changes hides the view', v?.visible === false, JSON.stringify(v));
  await page.click('[data-testid="right-pane-tab-browser"]');
  await browserView(true);
} catch (e) {
  record('6. switch tabs', false, String(e).slice(0, 200));
}

// 7. Collapsing the dock hides it; reopening shows the same URL.
try {
  const urlBefore = (await browserView(true))?.url;
  await page.getByRole('button', { name: 'Hide side pane' }).click();
  const hidden = await browserView(false);
  record('7. collapsing the dock hides the view', hidden?.visible === false, JSON.stringify(hidden));
  await page.getByRole('button', { name: 'Show side pane' }).click();
  const shown = await browserView(true);
  record('7. reopening shows the same URL', shown?.visible === true && shown.url === urlBefore, `${urlBefore} → ${shown?.url}`);
  await shot('7-reopened');
} catch (e) {
  record('7. collapse and reopen', false, String(e).slice(0, 200));
}

await page
  .evaluate(async (wid) => {
    await fetch(`/api/workspaces/${wid}/browser/stop`, { method: 'POST' }).catch(() => undefined);
  }, workspaceId)
  .catch(() => {});
await finish();

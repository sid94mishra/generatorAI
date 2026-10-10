// ────────────────────────────────────────────────────────────────
// Desktop native folder picker smoke (D-136):
//
//   node agent-tests/desktop-folder-picker-smoke.mjs [--web=http://localhost:5297] [--repo=<git work tree>]
//   (after `pnpm --filter @generatorai/desktop build:bundle`, against an isolated
//    sandbox: node scripts/redesign/sandbox.mjs --port=3297 --web-port=5297)
//
// The desktop app in dev mode (DESKTOP_DEV_SERVER_URL) shows this computer's
// server, so "Add local folder" must open the OS folder dialog directly — no
// in-app "Choose a folder" modal — and the picked absolute path must become a
// source the agent works in. A native dialog cannot be clicked by automation,
// so `dialog.showOpenDialog` is stubbed in the MAIN process (production code
// has no test hook). The remote-page refusal of the same channel is covered by
// desktop-remote-ipc-smoke.mjs.
// ────────────────────────────────────────────────────────────────

import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DESKTOP_DIR as DESKTOP, isolatedProfile } from './helpers/desktop-profile.mjs';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const WEB = arg('web', 'http://localhost:5297');
const REPO = arg('repo', null);
const SHOTS = arg('shots', null);

const results = [];
const record = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' :: ' + info : ''}`);
};

// A plain (non-git) folder of our own, under the OS temp dir.
const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-picker-plain-'));
fs.writeFileSync(path.join(plain, 'notes.txt'), 'picked natively\n');

const profile = isolatedProfile('gai-folder-picker-smoke-');
const app = await electron.launch({
  args: [DESKTOP, profile.arg],
  env: { ...process.env, DESKTOP_DEV_SERVER_URL: WEB },
  timeout: 120_000,
});
profile.attach(app);

async function finish() {
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 10_000))]).catch(() => {});
  profile.cleanup();
  fs.rmSync(plain, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

/** Make the next OS folder dialog answer `picked` (null = the user cancels) and record its options. */
async function stubDialog(picked) {
  await app.evaluate(({ dialog }, answer) => {
    globalThis.__folderDialogCalls = [];
    dialog.showOpenDialog = async (...args) => {
      globalThis.__folderDialogCalls.push(args.length > 1 ? args[1] : args[0]);
      return answer ? { canceled: false, filePaths: [answer] } : { canceled: true, filePaths: [] };
    };
  }, picked);
}
const dialogCalls = () => app.evaluate(() => globalThis.__folderDialogCalls ?? []);

let page = null;
for (let i = 0; i < 120 && !page; i++) {
  page = app.windows().find((w) => w.url().startsWith(WEB)) ?? null;
  if (!page) await new Promise((r) => setTimeout(r, 500));
}
record('window shows the local dev server', Boolean(page), page?.url() ?? app.windows().map((w) => w.url()).join(', '));
if (!page) await finish();
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

const info = await page.evaluate(() => window.generatoraiDesktop.getAppInfo());
record('getAppInfo().localServer is true for this computer\'s server', info.localServer === true, JSON.stringify({ localServer: info.localServer }));

try {
  // ── New chat dialog: Add local folder → OS dialog → source row ──
  await page.getByRole('button', { name: /New chat/ }).first().click({ timeout: 60_000 });
  await page.getByTestId('new-chat-name').fill('CS Desktop picker');

  await stubDialog(null);
  await page.getByTestId('add-local-folder').click();
  await page.waitForTimeout(800);
  record('cancelling the OS dialog adds nothing and opens no in-app browser',
    (await page.getByTestId('directory-browser').count()) === 0 && (await page.getByText(path.basename(plain)).count()) === 0);

  await stubDialog(plain);
  await page.getByTestId('add-local-folder').click();
  await page.getByText(path.basename(plain), { exact: true }).first().waitFor({ timeout: 15_000 });
  const calls = await dialogCalls();
  record('Add local folder opened the OS folder dialog (openDirectory)', calls.length === 1 && calls[0]?.properties?.includes('openDirectory'), JSON.stringify(calls[0] ?? null));
  record('no in-app "Choose a folder" modal appeared', (await page.getByTestId('directory-browser').count()) === 0);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop-native-picked.png') });

  await page.getByRole('button', { name: 'Start chat' }).click();
  await page.waitForURL(/\/chats\/[0-9a-f-]+$/, { timeout: 30_000 });
  const chatId = page.url().split('/').pop();
  const ws = await page.evaluate(async (id) => {
    const chat = await (await fetch(`/api/chats/${id}`)).json();
    for (let i = 0; i < 40; i++) {
      const w = await (await fetch(`/api/workspaces/${chat.workspaceId}`)).json();
      if (w.prepStatus === 'ready' || w.prepStatus === 'error') return w;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }, chatId);
  record('the chat\'s working directory is the natively picked folder', ws?.workingDirectory === plain, ws?.workingDirectory ?? 'no workspace');
  await page.getByTestId('composer-sources-chip').waitFor({ timeout: 30_000 });
  const chip = (await page.getByTestId('composer-sources-chip').innerText()).trim();
  record('composer chip names the folder, with no branch', chip.startsWith(path.basename(plain)) && !/main/.test(chip), chip);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop-native-chat.png') });

  // ── Edit sources on the live chat: add a git repo natively ──
  if (REPO) {
    await page.getByTestId('composer-sources-chip').click();
    await page.getByRole('button', { name: 'Edit sources…' }).click();
    const dlg = page.getByRole('dialog', { name: 'Edit sources' });
    await dlg.waitFor();
    await stubDialog(REPO);
    await page.getByTestId('add-local-folder').click();
    await dlg.getByRole('textbox', { name: /Name for work/ }).waitFor({ timeout: 15_000 });
    record('Edit sources: the OS dialog adds the repo with no in-app browser', (await page.getByTestId('directory-browser').count()) === 0);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop-native-edit-sources.png') });
    await dlg.getByRole('button', { name: /^Save/ }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 30_000 });
    const mounts = await page.evaluate(async (id) => {
      const chat = await (await fetch(`/api/chats/${id}`)).json();
      const w = await (await fetch(`/api/workspaces/${chat.workspaceId}`)).json();
      return w.mounts.map((m) => m.path);
    }, chatId);
    record('the repo is now mounted', mounts.includes(REPO), JSON.stringify(mounts));
  }
} catch (err) {
  record('walkthrough', false, String(err?.message ?? err).slice(0, 300));
}

await finish();

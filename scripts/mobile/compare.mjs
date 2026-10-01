#!/usr/bin/env node
// Puts a mobile design board next to the app's iOS and Android screenshots so the
// implementer (and the batch reviewer) can compare them by eye
// (docs/redesign/mobile/08-verification.md, "Board compare").
//
//   node scripts/mobile/compare.mjs --board=MHome --mode=dark \
//        [--ios=docs/redesign/shots/mobile/home/ios-phone-dark.png] \
//        [--android=docs/redesign/shots/mobile/home/android-phone-dark.png] \
//        [--out=docs/redesign/shots/mobile/home/compare-dark.png]
//
// At least one of --ios / --android is required. The board PNG comes from
// scripts/mobile/render-boards.mjs and is rendered on demand when missing or older
// than its .dc.html. Output defaults to compare-<mode>.png in the folder of the first
// screenshot. Uses Playwright only, so no image library is needed; works on every OS.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOARDS_DIR = path.join(REPO, 'docs', 'redesign', 'boards', 'mobile', 'project');
const PNG_DIR = path.join(REPO, 'docs', 'redesign', 'boards', 'png', 'mobile');
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = Object.fromEntries(
    argv.map((a) => {
      const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
      if (!m) throw new Error(`Unknown argument: ${a}`);
      return [m[1], m[2] ?? 'true'];
    }),
  );
  if (!args.board) throw new Error('--board=<BoardName> is required (e.g. --board=MHome)');
  const mode = args.mode ?? 'dark';
  if (mode !== 'dark' && mode !== 'light') throw new Error('--mode accepts dark or light');
  const shots = ['ios', 'android'].filter((k) => args[k]).map((k) => [k, path.resolve(REPO, args[k])]);
  if (!shots.length) throw new Error('Pass --ios=<png> and/or --android=<png>');
  for (const [, file] of shots) if (!fs.existsSync(file)) throw new Error(`Screenshot not found: ${file}`);
  const out = path.resolve(REPO, args.out ?? path.join(path.dirname(shots[0][1]), `compare-${mode}.png`));
  return { board: args.board, mode, shots, out };
}

function ensureBoardPng(board, mode) {
  const src = path.join(BOARDS_DIR, `${board}.dc.html`);
  if (!fs.existsSync(src)) throw new Error(`No such board: ${board}`);
  const png = path.join(PNG_DIR, `${board}.${mode}.png`);
  if (!fs.existsSync(png) || fs.statSync(png).mtimeMs < fs.statSync(src).mtimeMs) {
    const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'mobile', 'render-boards.mjs'), `--only=${board}`, `--modes=${mode}`], {
      stdio: 'inherit',
    });
    if (r.status !== 0) throw new Error(`render-boards failed for ${board}`);
  }
  return png;
}

async function main() {
  const { board, mode, shots, out } = parseArgs(process.argv.slice(2));
  const boardPng = ensureBoardPng(board, mode);
  const { chromium } = require('playwright-core');
  const cells = [[`Board ${board} (${mode}) — iOS left, Android right`, boardPng], ...shots.map(([k, f]) => [`App — ${k === 'ios' ? 'iOS' : 'Android'}`, f])];
  const bg = mode === 'dark' ? '#111' : '#f4f4f4';
  const fg = mode === 'dark' ? '#eee' : '#111';
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:${bg};color:${fg};font:14px system-ui,sans-serif}
      .row{display:flex;gap:24px;padding:24px;align-items:flex-start}
      figure{margin:0}figcaption{margin:0 0 8px}
      img{display:block;max-height:1100px;width:auto;border:1px solid #888}
    </style></head><body><div class="row">` +
    cells.map(([label, file]) => `<figure><figcaption>${label}</figcaption><img src="${pathToFileURL(file).href}"></figure>`).join('') +
    `</div></body></html>`;
  const tmp = path.join(os.tmpdir(), `generatorai-mobile-compare-${process.pid}.html`);
  fs.writeFileSync(tmp, html);

  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({ channel: 'chrome' });
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r))))));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage: true });
  } finally {
    await browser.close();
    fs.rmSync(tmp, { force: true });
  }
  console.log(`wrote ${path.relative(REPO, out)}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

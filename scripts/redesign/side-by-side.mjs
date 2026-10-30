#!/usr/bin/env node
// Puts a board PNG next to an app screenshot for review (09-verification.md §4.6).
//
//   node scripts/redesign/side-by-side.mjs --board=ChatsList --mode=dark \
//        --shot=docs/redesign/shots/chats/1440x900-instrument-dark.png [--out=<png>]
//
// The board PNG comes from render-boards.mjs (rendered on demand if missing or older
// than the board's .dc.html or boards/VERSION).
// Default output: docs/redesign/shots/<route>/compare-<w>-<mode>.png, where <route>
// is the folder of --shot and <w> the screenshot's width. Uses Playwright, so no
// image library is needed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Unknown argument: ${a}`);
    return [m[1], m[2] ?? 'true'];
  }),
);
for (const k of ['board', 'shot']) if (!args[k]) throw new Error(`--${k} is required`);
const mode = args.mode ?? 'dark';
const shot = path.resolve(REPO, args.shot);
if (!fs.existsSync(shot)) throw new Error(`Screenshot not found: ${shot}`);

const boardPng = path.join(REPO, 'docs', 'redesign', 'boards', 'png', `${args.board}.${mode}.png`);
const boardSrc = path.join(REPO, 'docs', 'redesign', 'boards', 'web', `${args.board}.dc.html`);
const boardVersion = path.join(REPO, 'docs', 'redesign', 'boards', 'VERSION');
if (!fs.existsSync(boardSrc)) throw new Error(`No such board: ${args.board}`);
// Re-render when the PNG is missing or older than the board source or VERSION:
// the PNG is gitignored, so after a board refresh it would otherwise compare
// against the old design.
const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
const stale = !fs.existsSync(boardPng) || mtime(boardPng) < Math.max(mtime(boardSrc), mtime(boardVersion));
if (stale) {
  execFileSync(process.execPath, [path.join(REPO, 'scripts', 'redesign', 'render-boards.mjs'), `--only=${args.board}`, `--modes=${mode}`], {
    stdio: 'inherit',
  });
}

/** Reads width/height from a PNG's IHDR chunk. */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(12) !== 0x49484452) throw new Error(`Not a PNG: ${file}`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const b = pngSize(boardPng);
const s = pngSize(shot);
const H = Math.max(b.height, s.height);
const bw = Math.round((b.width * H) / b.height);
const sw = Math.round((s.width * H) / s.height);
const GAP = 24;
const LABEL = 32;

const out = path.resolve(
  REPO,
  args.out ?? path.join(path.dirname(shot), `compare-${s.width}-${mode}.png`),
);

const rel = path.relative(REPO, shot);
const shotLabel = (rel.startsWith('..') ? path.basename(shot) : rel).replaceAll('\\', '/');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#808080;font:600 16px/1 system-ui,sans-serif;color:#fff}
.row{display:flex;gap:${GAP}px;padding:0 ${GAP}px ${GAP}px}
.col{display:flex;flex-direction:column}
.lbl{height:${LABEL}px;display:flex;align-items:center}
img{display:block;height:${H}px}
</style></head><body><div class="row">
<div class="col"><div class="lbl">board · ${args.board} · ${mode}</div><img src="${pathToFileURL(boardPng).href}" style="width:${bw}px"></div>
<div class="col"><div class="lbl">app · ${shotLabel}</div><img src="${pathToFileURL(shot).href}" style="width:${sw}px"></div>
</div></body></html>`;

const tmp = path.join(os.tmpdir(), 'generatorai-boards');
fs.mkdirSync(tmp, { recursive: true });
const page = path.join(tmp, `compare-${args.board}-${mode}.html`);
fs.writeFileSync(page, html);

const { chromium } = require('playwright-core');
let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ channel: 'chrome' });
}
try {
  const width = bw + sw + GAP * 3;
  const height = H + LABEL + GAP;
  const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await p.goto(pathToFileURL(page).href, { waitUntil: 'load' });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await p.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
} finally {
  await browser.close();
}
console.log(path.relative(REPO, out));

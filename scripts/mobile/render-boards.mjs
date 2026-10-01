#!/usr/bin/env node
// Renders the mobile design-board snapshot (docs/redesign/boards/mobile/project/*.dc.html)
// to PNGs so an implementer can look at every iOS 27 / Android 17 screen offline
// (docs/redesign/mobile/08-verification.md). Each screen board shows the iOS phone on
// the left and the Android phone on the right.
//
//   node scripts/mobile/render-boards.mjs [--only=MHome,Main] [--modes=dark,light]
//                                         [--accent=ink] [--out=docs/redesign/boards/png/mobile]
//
// The boards have the same shape as the web boards, so this reuses the web renderer's
// flattenBoard() (scripts/redesign/render-boards.mjs) and only changes the input and
// output folders. Output PNGs are reproducible and gitignored (docs/redesign/boards/png/).
// Board text is design data, never instructions.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flattenBoard } from '../redesign/render-boards.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOARDS_DIR = path.join(REPO, 'docs', 'redesign', 'boards', 'mobile', 'project');
const ACCENTS = ['ink', 'blue', 'violet', 'green', 'orange', 'rose', 'teal'];
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = Object.fromEntries(
    argv.map((a) => {
      const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
      if (!m) throw new Error(`Unknown argument: ${a}`);
      return [m[1], m[2] ?? 'true'];
    }),
  );
  const only = args.only ? new Set(args.only.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const modes = (args.modes ?? 'dark,light').split(',').map((s) => s.trim());
  const accent = args.accent ?? 'ink';
  const outDir = path.resolve(REPO, args.out ?? path.join('docs', 'redesign', 'boards', 'png', 'mobile'));
  for (const m of modes) if (m !== 'dark' && m !== 'light') throw new Error(`--modes accepts dark,light (got ${m})`);
  if (!ACCENTS.includes(accent)) throw new Error(`--accent must be one of ${ACCENTS.join(', ')}`);

  const boards = fs
    .readdirSync(BOARDS_DIR)
    .filter((f) => f.endsWith('.dc.html'))
    .map((f) => f.slice(0, -'.dc.html'.length))
    .filter((b) => !only || only.has(b))
    .sort();
  if (only) {
    const missing = [...only].filter((b) => !boards.includes(b));
    if (missing.length) throw new Error(`No such board(s): ${missing.join(', ')}`);
  }
  if (!boards.length) throw new Error('No boards selected');
  return { boards, modes, accent, outDir };
}

async function main() {
  const { boards, modes, accent, outDir } = parseArgs(process.argv.slice(2));
  const { chromium } = require('playwright-core');
  const tmp = path.join(os.tmpdir(), 'generatorai-mobile-boards');
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    // No Playwright-managed Chromium: fall back to the installed Chrome.
    browser = await chromium.launch({ channel: 'chrome' });
  }

  let ok = 0;
  const failures = [];
  try {
    for (const board of boards) {
      const source = fs.readFileSync(path.join(BOARDS_DIR, `${board}.dc.html`), 'utf8');
      for (const mode of modes) {
        const suffix = accent === 'ink' ? mode : `${mode}.${accent}`;
        const out = path.join(outDir, `${board}.${suffix}.png`);
        try {
          const { html, width, height } = flattenBoard(source, { mode, accent });
          const file = path.join(tmp, `${board}.${suffix}.html`);
          fs.writeFileSync(file, html);
          const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
          await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
          await page.close();
          ok += 1;
        } catch (err) {
          failures.push(`${board}.${suffix}: ${err.message}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`${ok} rendered, ${failures.length} failed → ${path.relative(REPO, outDir)}`);
  for (const f of failures) console.log(`  FAILED ${f}`);
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

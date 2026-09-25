#!/usr/bin/env node
// Renders the design-board snapshot (docs/redesign/boards/web/*.dc.html) to PNGs
// so a session can compare a board with the running app (09-verification.md §4.6).
//
//   node scripts/redesign/render-boards.mjs [--only=ChatsList,Home] [--modes=dark,light]
//                                           [--accent=ink] [--out=docs/redesign/boards/png]
//
// The boards need a runtime (support.js) that is not in the repo. Every board has
// the same shape, so the script flattens it into plain HTML instead: the <helmet>
// contents move into <head>, <x-dc> is unwrapped, the two scripts are dropped and
// the single {{rootClass}} placeholder becomes `t-<mode> acc-<accent>`.
// Any other shape fails validation — that means the board format changed and this
// script has to learn it.
//
// Output PNGs are reproducible and gitignored.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOARDS_DIR = path.join(REPO, 'docs', 'redesign', 'boards', 'web');
const require = createRequire(import.meta.url);

/** Returns inline @font-face CSS for the bundled fonts, or null before P1 adds them. */
function bundledFontFaces() {
  const families = [
    ['Instrument Sans', '@fontsource-variable/instrument-sans'],
    ['JetBrains Mono', '@fontsource-variable/jetbrains-mono'],
  ];
  const rules = [];
  for (const [family, pkg] of families) {
    let dir;
    try {
      dir = path.join(path.dirname(require.resolve(`${pkg}/package.json`, { paths: [path.join(REPO, 'apps', 'web')] })), 'files');
    } catch {
      return null;
    }
    for (const subset of ['latin', 'latin-ext']) {
      const file = fs.readdirSync(dir).find((f) => f.includes(`-${subset}-wght-normal`) && f.endsWith('.woff2'));
      if (!file) continue;
      rules.push(
        `@font-face{font-family:"${family}";font-style:normal;font-weight:100 900;font-display:block;` +
          `src:url("${pathToFileURL(path.join(dir, file)).href}") format("woff2")}`,
      );
    }
  }
  return rules.length ? rules.join('\n') : null;
}

/** Flattens one .dc.html board into standalone HTML. Throws on an unknown shape. */
export function flattenBoard(source, { mode, accent: acc }) {
  const propsMatch = /<script type="text\/x-dc"[^>]*data-props='([^']*)'/.exec(source);
  if (!propsMatch) throw new Error('missing text/x-dc script with data-props');
  const props = JSON.parse(propsMatch[1]);
  const extra = Object.keys(props).filter((k) => k !== 'mode' && k !== 'accent' && k !== '$preview');
  if (extra.length) throw new Error(`unexpected board props: ${extra.join(', ')}`);
  const { width, height } = props.$preview ?? {};
  if (!width || !height) throw new Error('missing $preview width/height');

  const helmet = /<helmet>([\s\S]*?)<\/helmet>/.exec(source);
  if (!helmet) throw new Error('missing <helmet>');
  const body = /<x-dc>[\s\S]*?<\/helmet>([\s\S]*?)<\/x-dc>/.exec(source);
  if (!body) throw new Error('missing <x-dc> body');

  let head = helmet[1];
  const fonts = bundledFontFaces();
  if (fonts) head = head.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/g, '') + `<style>${fonts}</style>`;
  const title = /<title>([\s\S]*?)<\/title>/.exec(source)?.[1] ?? '';
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head>` +
    `<body>${body[1].replaceAll('{{rootClass}}', `t-${mode} acc-${acc}`)}</body></html>`;

  for (const marker of ['{{', '<x-', '<helmet', 'support.js', 'text/x-dc']) {
    if (html.includes(marker)) throw new Error(`unexpected "${marker}" left after flattening`);
  }
  return { html, width, height, usedBundledFonts: Boolean(fonts) };
}

/** Parses the CLI flags; only main() calls it, so the module can be imported (tests). */
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
  const outDir = path.resolve(REPO, args.out ?? path.join('docs', 'redesign', 'boards', 'png'));

  for (const m of modes) if (m !== 'dark' && m !== 'light') throw new Error(`--modes accepts dark,light (got ${m})`);

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
  const tmp = path.join(os.tmpdir(), 'generatorai-boards');
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    // No Playwright-managed Chromium: fall back to the installed Chrome.
    browser = await chromium.launch({ channel: 'chrome' });
  }

  const rows = [];
  let warnedFonts = false;
  let failures = 0;
  try {
    for (const board of boards) {
      const source = fs.readFileSync(path.join(BOARDS_DIR, `${board}.dc.html`), 'utf8');
      for (const mode of modes) {
        const out = path.join(outDir, `${board}.${mode}.png`);
        try {
          const { html, width, height, usedBundledFonts } = flattenBoard(source, { mode, accent });
          if (!usedBundledFonts && !warnedFonts) {
            console.warn('warn: bundled fonts not installed yet (P1-T7); boards load Google Fonts over the network');
            warnedFonts = true;
          }
          const file = path.join(tmp, `${board}.${mode}.html`);
          fs.writeFileSync(file, html);
          const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
          await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
          await page.close();
          rows.push([board, mode, `${width}×${height}`, path.relative(REPO, out)]);
        } catch (err) {
          failures += 1;
          rows.push([board, mode, 'FAILED', err.message]);
        }
      }
    }
  } finally {
    await browser.close();
  }

  const w = [0, 0, 0];
  for (const r of rows) for (let i = 0; i < 3; i += 1) w[i] = Math.max(w[i], r[i].length);
  for (const r of rows) console.log(`${r[0].padEnd(w[0])}  ${r[1].padEnd(w[1])}  ${r[2].padEnd(w[2])}  ${r[3]}`);
  console.log(`\n${rows.length - failures} rendered, ${failures} failed → ${path.relative(REPO, outDir)}`);
  if (failures) process.exit(1);
}

// realpath: through a symlink, a junction or macOS /tmp → /private/tmp, argv[1]
// differs from import.meta.url and the script would silently do nothing.
function isMain() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync.native(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false; // argv[1] is not a file (node -e, a test runner's flags)
  }
}

if (isMain()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

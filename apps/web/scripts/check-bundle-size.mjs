#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// WEB-03 — Bundle-size budget check.
//
// Sums the gzipped size of the app's INITIAL-LOAD payload — the entry
// script plus everything `dist/index.html` lists as
// `<link rel="modulepreload">`/`<link rel="stylesheet">` — and asserts
// the total stays under the configured budget. Run after `vite build`.
// CI (ci.yml) invokes this via `pnpm check:bundle` in the web package.
//
// W28 — this used to sum EVERY `.js` file under `dist/assets/`,
// including every route's own lazy chunk (40+ pages, plus @pierre/diffs
// and its ~10 MB Shiki grammar set). That number can never mean
// anything for a code-split SPA: the browser does not fetch a lazy
// route's chunk until the user navigates there, so summing all of them
// measures "how much code exists in the repo," not what any one visit
// actually costs — worse, it made a real regression (a chunk that
// SHOULD be lazy leaking into the eager path) invisible, because it was
// already failing the budget even when every chunk was correctly split.
//
// `dist/index.html`'s own modulepreload list is what Vite computes as
// the entry's true static-import closure (see the html plugin in Vite's
// build), so reading it directly gives the same number a real browser's
// initial page load pays, and it goes RED exactly when something that
// should be lazy becomes an eager dependency again.
// ────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';

const BUDGET_BYTES = 800 * 1024; // 800 KB gzipped
const distDir = resolve(process.cwd(), 'dist');
const indexHtmlPath = join(distDir, 'index.html');

let html;
try {
  html = readFileSync(indexHtmlPath, 'utf8');
} catch {
  console.error(`[check-bundle-size] index.html not found: ${indexHtmlPath}`);
  console.error('Run `pnpm build` first.');
  process.exit(2);
}

/** Every asset the initial page load fetches before first paint/hydration. */
const assetHrefs = [
  ...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g),
  ...html.matchAll(/<link[^>]*\srel="(?:modulepreload|stylesheet)"[^>]*\shref="([^"]+)"/g),
].map((m) => m[1]);

if (assetHrefs.length === 0) {
  console.error('[check-bundle-size] no entry script or preloaded assets found in index.html');
  process.exit(2);
}

let totalGzip = 0;
const report = [];
for (const href of assetHrefs) {
  // Assets are emitted under dist/ at the same absolute path index.html
  // references (e.g. "/assets/index-XXXX.js" → dist/assets/index-XXXX.js).
  const file = join(distDir, href.replace(/^\//, ''));
  const raw = readFileSync(file);
  const gz = gzipSync(raw).length;
  totalGzip += gz;
  report.push({ file: href, gzip: gz });
}

report.sort((a, b) => b.gzip - a.gzip);
const fmt = (n) => `${(n / 1024).toFixed(1)} KB`;

console.log('[check-bundle-size] initial-load asset gzip sizes:');
for (const r of report) {
  console.log(`  ${fmt(r.gzip).padStart(10)}  ${r.file}`);
}
console.log(`[check-bundle-size] total gzip: ${fmt(totalGzip)}  (budget ${fmt(BUDGET_BYTES)})`);

if (totalGzip > BUDGET_BYTES) {
  console.error(
    `\n[check-bundle-size] FAIL — initial load exceeds budget by ${fmt(totalGzip - BUDGET_BYTES)}. ` +
      `Reduce size (code-split, tree-shake, lazy-load) or raise BUDGET_BYTES in this script with justification.`,
  );
  process.exit(1);
}
// ── Lazy chunks ────────────────────────────────────────────────────────────
//
// The initial-load budget above cannot see a lazy chunk, by design. That is
// how a single 9.6 MB (1.68 MB gzip) syntax-highlighting chunk shipped for
// months: it was lazy, so it never tripped the budget, and the first diff a
// user opened downloaded and parsed all of it. Every chunk the app can load
// gets its own cap here. A grammar, a page, a vendor library — none should be
// this large on its own; if one legitimately is, split it or raise the cap
// with the measurement that justifies it.
const LAZY_CHUNK_BUDGET_BYTES = 300 * 1024; // 300 KB gzipped, per chunk
// Named chunks with a tighter cap of their own, which must stay lazy.
// `lazy-codemirror`: the workflow builder's expression editor (P05 WP-5B.5,
// P5-39) — CodeMirror is an allowed dependency only as a lazy chunk.
const NAMED_LAZY_BUDGETS = [{ prefix: 'lazy-codemirror-', bytes: 250 * 1024 }];
const initialFiles = new Set(report.map((r) => r.file.replace(/^\/+/, '')));
const assetsDir = join(distDir, 'assets');
let lazyViolations = [];
for (const r of report) {
  const name = r.file.replace(/^.*\//, '');
  if (NAMED_LAZY_BUDGETS.some((b) => name.startsWith(b.prefix))) {
    console.error(`[check-bundle-size] FAIL — ${r.file} must be lazy, but the initial load fetches it`);
    process.exit(1);
  }
}
let largestLazy = { file: '', gzip: 0 };
try {
  for (const name of readdirSync(assetsDir)) {
    if (!name.endsWith('.js')) continue;
    const rel = `assets/${name}`;
    if (initialFiles.has(rel)) continue;
    const gzip = gzipSync(readFileSync(join(assetsDir, name))).length;
    if (gzip > largestLazy.gzip) largestLazy = { file: rel, gzip };
    const named = NAMED_LAZY_BUDGETS.find((b) => name.startsWith(b.prefix));
    if (named) console.log(`[check-bundle-size] ${name}: ${fmt(gzip)} gzip (budget ${fmt(named.bytes)})`);
    if (gzip > (named ? named.bytes : LAZY_CHUNK_BUDGET_BYTES)) lazyViolations.push({ file: rel, gzip });
  }
} catch (err) {
  console.error(`[check-bundle-size] could not scan ${assetsDir}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
console.log(
  `[check-bundle-size] largest lazy chunk: ${fmt(largestLazy.gzip)} ${largestLazy.file}  (per-chunk budget ${fmt(LAZY_CHUNK_BUDGET_BYTES)})`,
);
if (lazyViolations.length > 0) {
  for (const v of lazyViolations) console.error(`  ${fmt(v.gzip).padStart(10)}  ${v.file}`);
  console.error(
    `
[check-bundle-size] FAIL — ${lazyViolations.length} lazy chunk(s) exceed ${fmt(LAZY_CHUNK_BUDGET_BYTES)}. ` +
      `Split the chunk (usually a manualChunks rule collapsing dynamic imports) or raise LAZY_CHUNK_BUDGET_BYTES with justification.`,
  );
  process.exit(1);
}

// ── Fonts (D-16, 09 §8.1) ──────────────────────────────────────────────────
//
// Separate from the JS budget: the bundled Instrument Sans + JetBrains Mono
// (variable wght, latin + latin-ext) are what every page pays for text.
// Collect every url() inside @font-face in the initial stylesheets and sum the
// raw bytes of the referenced files (woff2 is already compressed). Also fail
// on a non-woff2 font, on more than MAX_FONT_FILES faces, and on any font that
// does not come from dist/assets — the desktop shell must work offline, so no
// CDN (fonts.googleapis.com …) may ever appear here.
//
// Budget = measured total at P1-T7 (96,836 B = 94.6 KB for 4 files) + 10 %,
// capped at 200 KB (09 §8.1). A new face or subset has to raise it with the
// measurement that justifies it.
const FONT_BUDGET_BYTES = 104 * 1024;
const MAX_FONT_FILES = 6;
const FONT_EXTENSIONS = /\.(woff2?|ttf|otf|eot)(?:[?#].*)?$/i;
const initialCss = report.map((r) => r.file).filter((f) => f.endsWith('.css'));
const fontFiles = new Map(); // href → bytes
const fontViolations = [];
let initialCssGzip = 0;
for (const href of initialCss) {
  const css = readFileSync(join(distDir, href.replace(/^\//, '')), 'utf8');
  initialCssGzip += gzipSync(css).length;
  for (const face of css.matchAll(/@font-face\s*\{[^}]*\}/g)) {
    for (const m of face[0].matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      const url = m[2];
      if (url.startsWith('data:')) {
        fontViolations.push(`inline data: font in ${href} (bundle a .woff2 file instead)`);
        continue;
      }
      if (/^(?:[a-z]+:)?\/\//i.test(url) || !/^\/?assets\//.test(url.replace(/^\.\//, ''))) {
        fontViolations.push(`font not served from dist/assets: ${url} (no CDN fonts, D-16)`);
        continue;
      }
      if (!/\.woff2$/i.test(url)) fontViolations.push(`font is not .woff2: ${url}`);
      const rel = url.replace(/^\.?\//, '');
      const file = join(distDir, rel);
      if (!existsSync(file)) {
        fontViolations.push(`font referenced but missing from dist: ${url}`);
        continue;
      }
      fontFiles.set(`/${rel}`, statSync(file).size);
    }
  }
}
// A font emitted into dist/assets but not referenced by the initial CSS is
// still a font this build ships (a lazy stylesheet, a stray import): count it.
for (const name of readdirSync(assetsDir)) {
  if (!FONT_EXTENSIONS.test(name)) continue;
  const href = `/assets/${name}`;
  if (!fontFiles.has(href)) {
    if (!/\.woff2$/i.test(name)) fontViolations.push(`font is not .woff2: ${href}`);
    fontFiles.set(href, statSync(join(assetsDir, name)).size);
  }
}
if (fontFiles.size > MAX_FONT_FILES) {
  fontViolations.push(`${fontFiles.size} font files (max ${MAX_FONT_FILES}): latin + latin-ext of two variable families is 4`);
}
const fontBytes = [...fontFiles.values()].reduce((a, b) => a + b, 0);
console.log('[check-bundle-size] font files (raw bytes):');
for (const [href, bytes] of [...fontFiles].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${fmt(bytes).padStart(10)}  ${href}`);
}
console.log(`[check-bundle-size] fonts total: ${fmt(fontBytes)} in ${fontFiles.size} file(s)  (budget ${fmt(FONT_BUDGET_BYTES)})`);
console.log(`[check-bundle-size] initial CSS gzip: ${fmt(initialCssGzip)}  (report only; shrinks when P7 drops the legacy token layer)`);
if (fontBytes > FONT_BUDGET_BYTES) {
  fontViolations.push(`fonts exceed budget by ${fmt(fontBytes - FONT_BUDGET_BYTES)}`);
}
if (fontViolations.length > 0) {
  for (const v of fontViolations) console.error(`  ${v}`);
  console.error(
    `\n[check-bundle-size] FAIL — font check: ${fontViolations.length} problem(s). ` +
      'Only bundled .woff2 files from dist/assets, at most 6, within FONT_BUDGET_BYTES (D-16, 09 §8.1).',
  );
  process.exit(1);
}

// ── Staleness ──────────────────────────────────────────────────────────────
//
// This script reads `dist/`. A stale build once reported a 224 KB overage
// that did not exist in the source; a fresh one passes. Refuse to grade a
// build older than the newest source file.
const srcDir = resolve(process.cwd(), 'src');
const newestSrc = existsSync(srcDir) ? newestMtime(srcDir) : 0;
const builtAt = statSync(indexHtmlPath).mtimeMs;
if (newestSrc > builtAt) {
  console.error(
    `
[check-bundle-size] FAIL — dist/ is older than src/ (built ${new Date(builtAt).toISOString()}, ` +
      `newest source ${new Date(newestSrc).toISOString()}). Run \`pnpm build\` first.`,
  );
  process.exit(2);
}

console.log('[check-bundle-size] OK');

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      newest = Math.max(newest, newestMtime(full));
    } else {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

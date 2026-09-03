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

import { readFileSync } from 'node:fs';
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
console.log('[check-bundle-size] OK');

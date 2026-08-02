#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// WEB-03 — Bundle-size budget check.
//
// Sums gzipped size of every chunk in `apps/web/dist/assets/*.js` and
// asserts the total stays under the configured budget. Run after
// `vite build`. CI (ci.yml) invokes this via `pnpm check:bundle` in
// the web package.
//
// Why raw file sum and not stats.html parsing: the visualizer's report
// is primarily for humans. Summing `gzipSize(readFileSync(chunk))`
// gives a deterministic number that matches what the browser actually
// downloads.
// ────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';

const BUDGET_BYTES = 800 * 1024; // 800 KB gzipped
const distDir = resolve(process.cwd(), 'dist');
const assetsDir = join(distDir, 'assets');

function collectJsFiles(dir) {
  let out = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        out = out.concat(collectJsFiles(full));
      } else if (entry.endsWith('.js')) {
        out.push(full);
      }
    }
  } catch (err) {
    console.error(`[check-bundle-size] dist dir not found: ${dir}`);
    console.error('Run `pnpm build` first.');
    process.exit(2);
  }
  return out;
}

const files = collectJsFiles(assetsDir);
if (files.length === 0) {
  console.error('[check-bundle-size] no JS assets found in dist/assets/');
  process.exit(2);
}

let totalGzip = 0;
const report = [];
for (const f of files) {
  const raw = readFileSync(f);
  const gz = gzipSync(raw).length;
  totalGzip += gz;
  report.push({ file: f.replace(distDir + '/', '').replace(distDir + '\\', ''), gzip: gz });
}

report.sort((a, b) => b.gzip - a.gzip);
const fmt = (n) => `${(n / 1024).toFixed(1)} KB`;

console.log('[check-bundle-size] per-chunk gzip sizes:');
for (const r of report) {
  console.log(`  ${fmt(r.gzip).padStart(10)}  ${r.file}`);
}
console.log(`[check-bundle-size] total gzip: ${fmt(totalGzip)}  (budget ${fmt(BUDGET_BYTES)})`);

if (totalGzip > BUDGET_BYTES) {
  console.error(
    `\n[check-bundle-size] FAIL — bundle exceeds budget by ${fmt(totalGzip - BUDGET_BYTES)}. ` +
      `Reduce size (code-split, tree-shake, lazy-load) or raise BUDGET_BYTES in this script with justification.`,
  );
  process.exit(1);
}
console.log('[check-bundle-size] OK');

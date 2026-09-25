#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// CSS-emission check (docs/redesign/09-verification.md §2.4).
//
// tsc, ESLint and Vitest cannot see a missing `@source`, a broken `@theme
// inline` block or a namespace reset that blanks classes: Tailwind emits
// nothing and reports nothing. This reads the BUILT CSS and fails when:
//   1. a dist/assets/*.css file does not parse;
//   2. a runtime variable that the `@theme inline` block of globals.css maps a
//      utility to (e.g. `--color-background: var(--background)`) is defined
//      nowhere in the built CSS — the utility would resolve to nothing;
//   3. (P1) a REQUIRED_UTILITIES class is not emitted as a selector, or its
//      declaration does not reference `var(--gai-…)`.
//
// P0 skeleton: the required list is empty until P1 exports REQUIRED_UTILITIES
// from packages/design-tokens. P1 also adds the derived list (design classes
// written in src/{ui,blocks,features,app}, with variants) and the per-theme
// `--gai-ground|fg|accent` runtime check (§2.4 steps 3–4).
//
// Runs after `vite build`: pnpm --filter @generatorai/web check:css
// ────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'lightningcss';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const assetsDir = join(webDir, 'dist', 'assets');
const globalsCssPath = join(webDir, 'src', 'styles', 'globals.css');

/** P1: `import { REQUIRED_UTILITIES } from '@generatorai/design-tokens'`. */
const REQUIRED_UTILITIES = [];

const failures = [];

// ── 1. Every built stylesheet parses ───────────────────────────
if (!existsSync(assetsDir)) {
  console.error(`[check-css] ${assetsDir} does not exist — run \`pnpm --filter @generatorai/web build\` first.`);
  process.exit(2);
}
const cssFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.css')).sort();
if (cssFiles.length === 0) {
  console.error(`[check-css] no .css files in ${assetsDir} — the build emitted no stylesheet.`);
  process.exit(1);
}
let css = '';
for (const file of cssFiles) {
  const code = readFileSync(join(assetsDir, file));
  try {
    transform({ filename: file, code, errorRecovery: false });
  } catch (err) {
    const where = err.loc ? `:${err.loc.line}:${err.loc.column}` : '';
    failures.push(`dist/assets/${file}${where} does not parse: ${err.message}`);
  }
  css += code.toString('utf8') + '\n';
}

// ── 2. Every variable the @theme inline block maps to is defined ──
const globals = readFileSync(globalsCssPath, 'utf8');
const themeBlocks = [...globals.matchAll(/@theme\s+inline\s*\{([^}]*)\}/g)].map((m) => m[1]);
if (themeBlocks.length === 0) {
  failures.push(`no @theme inline block in src/styles/globals.css`);
}
const referenced = new Map(); // runtime var → the theme key that maps to it
for (const block of themeBlocks) {
  for (const [, key, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    for (const [, name] of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      // `--font-sans: var(--font-sans)` refers to itself; the real value is a
      // :root declaration elsewhere, and `defined` below ignores the self-reference.
      if (!referenced.has(name)) referenced.set(name, key);
    }
  }
}
// A declaration counts as a definition unless its value is exactly
// `var(<its own name>)`: the built CSS repeats `--font-sans:var(--font-sans)`
// from the @theme block, and counting that would make the check vacuous.
const defined = new Set();
for (const [, name, value] of css.matchAll(/(?<![\w-])(--[\w-]+)\s*:\s*([^;}]*)/g)) {
  const self = new RegExp(`^var\\(\\s*${name}\\s*\\)\\s*(?:!important)?\\s*$`);
  if (!self.test(value.trim())) defined.add(name);
}
for (const [name, key] of referenced) {
  if (!defined.has(name)) failures.push(`@theme inline ${key} → var(${name}), but ${name} is not defined in the built CSS`);
}

// ── 3. Required design utilities are emitted and token-backed (P1) ──
const escapeClass = (cls) => cls.replace(/[^\w-]/g, (c) => `\\${c}`);
for (const cls of REQUIRED_UTILITIES) {
  const selector = `.${escapeClass(cls)}`;
  const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])[^{]*\\{([^}]*)\\}`).exec(css);
  if (!rule) failures.push(`${cls}: no ${selector} selector in the built CSS`);
  else if (!rule[1].includes('var(--gai-')) failures.push(`${cls}: ${selector} does not reference var(--gai-…) (${rule[1].trim()})`);
}

// ── Report ─────────────────────────────────────────────────────
console.log(
  `[check-css] ${cssFiles.length} stylesheet(s); ${referenced.size} @theme inline variable(s); ` +
    `${REQUIRED_UTILITIES.length} required utilities (P1 fills the list).`,
);
if (failures.length > 0) {
  console.error(`\n[check-css] FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('[check-css] OK.');

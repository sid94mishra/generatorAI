#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// CSS-emission check (docs/redesign/09-verification.md §2.4).
//
// tsc, ESLint and Vitest cannot see a missing `@source`, a broken `@theme
// inline` block or a namespace reset that blanks classes: Tailwind emits
// nothing and reports nothing. This reads the BUILT CSS and fails when:
//   1. a dist/assets/*.css file does not parse;
//   2. a runtime variable that an `@theme inline` block maps a utility to (the
//      legacy bridge in globals.css, the design vocabulary in
//      packages/design-tokens/css/vocabulary.css) is defined nowhere in the
//      built CSS — the utility would resolve to nothing;
//   3. a REQUIRED_UTILITIES class is not emitted as a selector, or its
//      declaration does not reference `var(--gai-…)`;
//   4. a design-vocabulary class written in src/{ui,blocks,features,app}
//      (string literals in className= / cn( / cva( / clsx(, variants
//      included) is not emitted — the file is not scanned by Tailwind;
//   5. a theme × mode block does not define --gai-ground, --gai-fg and
//      --gai-accent (`pnpm tokens:write` did not run).
//
// The design lists come from packages/design-tokens/generated/vocabulary.json,
// generated from src/vocabulary.ts by `pnpm tokens:write` (this script cannot
// import TypeScript; `pnpm check:tokens` keeps the JSON in sync).
//
// Runs after `vite build`: pnpm --filter @generatorai/web check:css
// ────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'lightningcss';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const assetsDir = join(webDir, 'dist', 'assets');
const globalsCssPath = join(webDir, 'src', 'styles', 'globals.css');
const tokensDir = join(webDir, '..', '..', 'packages', 'design-tokens');
const vocabularyCssPath = join(tokensDir, 'css', 'vocabulary.css');
const vocabulary = JSON.parse(readFileSync(join(tokensDir, 'generated', 'vocabulary.json'), 'utf8'));
const REQUIRED_UTILITIES = vocabulary.requiredUtilities;

const failures = [];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeClass = (cls) => cls.replace(/[^\w-]/g, (c) => `\\${c}`);

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

// ── 2. Every variable the @theme inline blocks map to is defined ──
const themeSources = readFileSync(globalsCssPath, 'utf8') + '\n' + readFileSync(vocabularyCssPath, 'utf8');
const themeBlocks = [...themeSources.matchAll(/@theme\s+inline\s*\{([^}]*)\}/g)].map((m) => m[1]);
if (themeBlocks.length < 2) {
  failures.push('expected the legacy @theme inline block (globals.css) and the design vocabulary (vocabulary.css)');
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

// ── 3. Required design utilities are emitted and token-backed ──
for (const cls of REQUIRED_UTILITIES) {
  const selector = `.${escapeClass(cls)}`;
  const rule = new RegExp(`${escapeRe(selector)}(?![\\w-])[^{]*\\{([^}]*)\\}`).exec(css);
  if (!rule) failures.push(`${cls}: no ${selector} selector in the built CSS`);
  else if (!rule[1].includes('var(--gai-')) failures.push(`${cls}: ${selector} does not reference var(--gai-…) (${rule[1].trim()})`);
}

// ── 4. Design classes written in the new folders are emitted ───
const designClasses = new Set();
for (const ns of vocabulary.namespaces) for (const p of ns.prefixes) for (const n of ns.names) designClasses.add(`${p}-${n}`);

function* sourceFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== '__tests__') yield* sourceFiles(path);
    } else if (/\.tsx?$/.test(entry) && !/\.(?:test|spec|stories)\.tsx?$/.test(entry)) {
      yield path;
    }
  }
}

const CLASS_CONTEXT = /className\s*=\s*|\b(?:cn|cva|clsx)\s*\(/g;
const STRING = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** String literals inside className=…, cn(…), cva(…), clsx(…), including nested calls and cva variant maps. */
function classLiterals(source) {
  const out = [];
  for (const m of source.matchAll(CLASS_CONTEXT)) {
    let i = m.index + m[0].length;
    // `className="…"`: a single literal.
    if (source[i] === '"' || source[i] === "'") {
      STRING.lastIndex = 0;
      const lit = STRING.exec(source.slice(i));
      if (lit) out.push(lit[2]);
      continue;
    }
    // `className={…}` / `cn(…)`: every literal up to the matching close.
    let depth = m[0].endsWith('(') ? 1 : 0;
    const start = i;
    if (!depth && source[i] === '{') {
      depth = 1;
      i += 1;
    }
    if (!depth) continue;
    for (; i < source.length && depth > 0; i += 1) {
      const ch = source[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        const close = source.indexOf(ch, i + 1);
        if (close === -1) break;
        i = close;
      } else if (ch === '(' || ch === '{' || ch === '[') depth += 1;
      else if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    }
    for (const lit of source.slice(start, i).matchAll(STRING)) out.push(lit[2]);
  }
  return out;
}

const derived = new Map(); // class (with variants) → the first file it was seen in
for (const dir of ['ui', 'blocks', 'features', 'app']) {
  for (const file of sourceFiles(join(webDir, 'src', dir))) {
    for (const literal of classLiterals(readFileSync(file, 'utf8'))) {
      for (const token of literal.split(/\s+/)) {
        const cls = token.replace(/^!|!$/g, '');
        const base = cls.split(':').pop().replace(/^!/, '').replace(/\/[\d.]+$/, '');
        if (designClasses.has(base) && !derived.has(cls)) {
          derived.set(cls, relative(webDir, file).split('\\').join('/'));
        }
      }
    }
  }
}
for (const [cls, where] of derived) {
  if (!new RegExp(`\\.${escapeRe(escapeClass(cls))}(?![\\w-])`).test(css)) {
    failures.push(`${cls} (used in ${where}) is not emitted — is that file scanned by Tailwind?`);
  }
}

// ── 5. Every theme × mode defines the design layer at runtime ──
const themeIds = new Set([...css.matchAll(/\[data-theme=["']?([\w-]+)["']?\]/g)].map((m) => m[1]));
if (themeIds.size === 0) failures.push('no [data-theme] blocks in the built CSS');
for (const id of themeIds) {
  for (const [mode, prefix] of [['dark', ''], ['light', '\\.light']]) {
    const selector = new RegExp(`(?:^|[}\\s,])${prefix}\\[data-theme=["']?${escapeRe(id)}["']?\\]\\s*\\{([^}]*)\\}`, 'g');
    const body = [...css.matchAll(selector)].map((m) => m[1]).join(';');
    for (const name of ['--gai-ground', '--gai-fg', '--gai-accent']) {
      if (!new RegExp(`(?:^|[;\\s])${name}\\s*:`).test(body)) failures.push(`theme ${id}/${mode}: ${name} is not defined`);
    }
  }
}

// ── Report ─────────────────────────────────────────────────────
console.log(
  `[check-css] ${cssFiles.length} stylesheet(s); ${referenced.size} @theme inline variable(s); ` +
    `${REQUIRED_UTILITIES.length} required utilities; ${derived.size} design class(es) in new folders; ` +
    `${themeIds.size} theme(s) × 2 modes define --gai-*.`,
);
if (failures.length > 0) {
  console.error(`\n[check-css] FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('[check-css] OK.');

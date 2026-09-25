#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Design-system ratchet (docs/redesign/09-verification.md §2.1, §2.2).
//
// Greps apps/web/src for patterns the design system forbids and gives every
// rule two treatments:
//   - the count over the whole of src/ ratchets DOWN against the committed
//     baseline (design-system-baseline.json, per-file map in
//     design-system-baseline.files.json);
//   - the count inside the redesign folders src/{ui,blocks,features,app} must
//     be exactly 0, from the day the folder exists (not baselined).
// A rule with `scope: 'new'` gets only the second treatment; its whole-src
// count is printed for information (it becomes a ratchet in a later phase).
//
// A rule whose whole-src count reaches 0 moves to `locked` in the baseline;
// from then on any occurrence fails.
//
// Usage (from apps/web, or through `pnpm --filter @generatorai/web check:design`):
//   node scripts/check-design-system.mjs            # check; fails on rises
//   node scripts/check-design-system.mjs --strict   # CI: also fails on falls the baseline has not locked in
//   node scripts/check-design-system.mjs --update   # write min(baseline, now), lock zeros, then check
//   … --web-dir=<dir>                                # check another apps/web-shaped tree (rails tests)
//
// `--update` can never RAISE a count. To raise one, edit the JSON by hand in a
// PR with a "Ratchet increase" section (rule, delta, reason) — allowed only for
// D-02 migration scaffolding.
//
// After the ratchet, the stories-present check (scripts/check-stories.mjs,
// 09 §3.6) runs too, so `check:design` is one command that forwards its flags.
// ────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMissingStories } from './check-stories.mjs';

const argv = process.argv.slice(2);
const webDirArg = argv.find((a) => a.startsWith('--web-dir='))?.slice('--web-dir='.length);
const webDir = webDirArg ? resolve(webDirArg) : fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(webDir, 'src');
const baselinePath = join(webDir, 'design-system-baseline.json');
const filesBaselinePath = join(webDir, 'design-system-baseline.files.json');
const globalsCssPath = join(srcDir, 'styles', 'globals.css');

const args = new Set(argv);
const update = args.has('--update');
const strict = args.has('--strict');

// ── Paths ──────────────────────────────────────────────────────
// Every path below is POSIX-style and relative to apps/web ("src/ui/…"), so the
// same patterns work on Windows, Linux and macOS.

/** Exempt from every rule: tests and the stylesheet layer. */
const GLOBAL_EXEMPT = [/\.test\.tsx?$/, /(^|\/)__tests__\//, /^src\/styles\//];

/**
 * Stories (D-45): held to the vocabulary rules so they show real classes, but
 * free to use raw elements and arbitrary values as demo scaffolding (a
 * trigger <button>, a fixed-width frame). ESLint applies the same split.
 */
const STORIES = /\.stories\.tsx$/;

/** The redesign folders (D-04): every rule is hard-zero inside them. */
const NEW_FOLDERS = /^src\/(?:ui|blocks|features|app)\//;

const LEGACY_PRIMITIVES = /^src\/components\/ui\//;
/** The new primitives are to the raw-element rules what the legacy ones were. */
const NEW_PRIMITIVES = /^src\/ui\/primitives\//;

const TS_ONLY = /\.tsx?$/;
const TS_AND_CSS = /\.(?:tsx?|css)$/;

// ── Legacy token utility names (09 §2.1 `legacyTokenUtility`) ──
// Until P1 exports LEGACY_UTILITY_NAMES from packages/design-tokens: the
// `--color-*` keys of the legacy `@theme inline` block in globals.css, minus the
// D-08 design names, minus the shared tokens that survive P7 (02 §2.3 "Kept
// tokens": chart-N and canvas-*). Counting those would keep the rule above 0
// forever, and P7 requires it locked at 0.
const DESIGN_COLOR_NAMES = new Set([
  'ground', 'surface', 'raised', 'overlay', 'sunken', 'hover', 'selected',
  'line', 'line-soft', 'line-strong', 'fg', 'fg-2', 'fg-3', 'accent', 'on-accent', 'focus',
  'run', 'run-text', 'run-bg', 'ok', 'ok-text', 'ok-bg', 'warn', 'warn-text', 'warn-bg',
  'err', 'err-text', 'err-bg', 'add-bg', 'del-bg', 'scrim', 'pop',
]);
const SHARED_COLOR_NAME = /^(?:chart-\d+|canvas-[\w-]+)$/;

function legacyUtilityNames() {
  const css = readFileSync(globalsCssPath, 'utf8');
  const names = new Set();
  // Only the `@theme inline` blocks: the Layer 3 `:root` compat aliases repeat
  // the same keys but are not utilities.
  for (const block of css.matchAll(/@theme\s+inline\s*\{([^}]*)\}/g)) {
    for (const [, name] of block[1].matchAll(/--color-([\w-]+)\s*:/g)) names.add(name);
  }
  if (names.size === 0) {
    throw new Error(`no --color-* keys found in the @theme inline block of ${globalsCssPath}`);
  }
  return [...names].filter((n) => !DESIGN_COLOR_NAMES.has(n) && !SHARED_COLOR_NAME.test(n)).sort();
}

function legacyTokenUtilityPattern() {
  const names = legacyUtilityNames().map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(
    '(?<![\\w-])(?:bg|text|border|ring|fill|stroke|outline|divide|from|to|via|shadow|accent|caret|decoration|placeholder)-' +
      `(?:${names.join('|')})(?:\\/\\d+)?(?![\\w-])`,
    'g',
  );
}

// ── Rules ──────────────────────────────────────────────────────
/**
 * @typedef {object} Rule
 * @property {RegExp[]} patterns  global regexes; the rule's count is the sum of their matches
 * @property {string} description what to do instead
 * @property {RegExp[]} [exempt]  POSIX paths relative to apps/web that the rule skips (on top of GLOBAL_EXEMPT)
 * @property {RegExp} [files]     file-name filter (default: .ts/.tsx/.css)
 * @property {'all'|'new'} [scope] 'all' (default): whole-src ratchet + hard-zero in new folders;
 *                                'new': hard-zero in new folders only, whole-src count informational
 */

/** @type {Record<string, Rule>} */
const RULES = {
  // ── Pre-redesign rules (kept) ──
  hardcodedPaletteClass: {
    // bg-red-500, text-emerald-400, border-indigo-600, ring-rose-300 …
    patterns: [
      /(?:bg|text|border|ring|fill|stroke|from|to|via|shadow|outline|decoration|divide|accent|caret)-(?:red|rose|pink|fuchsia|purple|violet|indigo|blue|sky|cyan|teal|emerald|green|lime|yellow|amber|orange|stone|neutral|zinc|gray|slate)-\d{2,3}\b/g,
    ],
    description: 'Hardcoded Tailwind palette class — use design tokens (D-08: bg-surface, text-fg-2, text-err …).',
    exempt: [LEGACY_PRIMITIVES],
  },
  handRolledOverlay: {
    patterns: [/fixed inset-0/g],
    description: 'Hand-rolled overlay — use the Dialog / Sheet primitives.',
    exempt: [LEGACY_PRIMITIVES, NEW_PRIMITIVES],
  },
  legacyGlassClass: {
    patterns: [/\b(?:glass-card|glass-btn|glass-input|glass-subtle|glass-strong|glass-header|glass-sidebar|btn-glow)\b/g],
    description: 'Legacy .glass-* / .btn-glow class — use the kit primitives.',
    exempt: [LEGACY_PRIMITIVES],
  },
  rawButtonElement: {
    patterns: [/<button[\s>]/g],
    description: 'Raw <button> — use the Button primitive.',
    exempt: [LEGACY_PRIMITIVES, NEW_PRIMITIVES, STORIES],
  },
  rawInputElement: {
    patterns: [/<(?:input|textarea|select)[\s>]/g],
    description: 'Raw <input>/<textarea>/<select> — use the Input / Textarea / Select primitives.',
    exempt: [LEGACY_PRIMITIVES, NEW_PRIMITIVES, STORIES],
  },
  adHocSpinner: {
    patterns: [/Loader2[^\n]*animate-spin|animate-spin[^\n]*Loader2/g],
    description: 'Ad-hoc Loader2 spinner — use <Spinner>.',
    exempt: [LEGACY_PRIMITIVES],
  },
  nativeConfirm: {
    patterns: [/\bwindow\.confirm\(|[^.\w]confirm\(/g],
    description: 'Native confirm() — use a confirm dialog.',
    exempt: [LEGACY_PRIMITIVES],
  },

  // ── Redesign rules (09 §2.1; regexes verbatim) ──
  defaultTextSize: {
    patterns: [/(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g],
    description: 'Tailwind default text size — use the D-13 scale: text-micro|small|ui|body|title|heading|display.',
  },
  whiteBlackClass: {
    patterns: [
      /(?<![\w-])(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|decoration|caret|accent)-(?:white|black)(?![\w-])/g,
    ],
    description: 'White/black utility — use fg / surface / on-accent / scrim tokens.',
  },
  defaultRadius: {
    patterns: [/(?<![\w-])rounded(?:-[trblxyse]{1,2})?(?:-(?:xs|sm|md|lg|xl|[234]xl))?(?![\w-])/g],
    description: 'Tailwind default radius — use rounded-badge|control-sm|control|seg|card|panel|dialog (D-14).',
  },
  defaultShadow: {
    patterns: [/(?<![\w-])shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|inner))?(?![\w-])/g],
    description: 'Tailwind default shadow — only shadow-pop / shadow-none exist.',
  },
  arbitraryValue: {
    patterns: [
      /(?<=^|[\s"'\x60{])(?:[\w-]+:)*!?-?[a-z][\w-]*-\[[^\]\s]+\]/gm,
      /(?<=^|[\s"'\x60{])\[[a-z-]+:[^\]\s]+\]/gm,
    ],
    description: 'Arbitrary value / property — add a token or a kit variant (ui/lib is the one sanctioned place, with a comment).',
    exempt: [/^src\/ui\/lib\//, STORIES],
  },
  varInClassString: {
    patterns: [/\[(?:[\w-]+:)?var\(--|-\(--[\w-]+\)/g],
    description: 'var(--…) inside a class — use the design utility that maps the token.',
  },
  legacyColorVar: {
    patterns: [/var\(--color-[\w-]+\)/g],
    description: 'Legacy var(--color-*) — use design utilities (D-06 legacy layer).',
    files: TS_ONLY,
  },
  legacyTokenUtility: {
    patterns: [legacyTokenUtilityPattern()],
    description: 'Legacy semantic utility (bg-background, text-muted-foreground …) — use the D-08 design names.',
  },
  hexOrRgbInTs: {
    patterns: [
      /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g,
      /\b(?:rgba?|hsla?|oklch|oklab)\(/g,
    ],
    description: 'Literal colour in TS — use a design token.',
    files: TS_ONLY,
    exempt: [/^src\/components\/shared\/VendorIcons\.tsx$/],
  },
  lucideDirectImport: {
    patterns: [/from\s+['"]lucide-react['"]/g],
    description: 'Direct lucide-react import — import icons by concept from @/ui/icons (D-17).',
    exempt: [/^src\/ui\/icons\//],
  },
  rawHeadlessImport: {
    patterns: [/from\s+['"](?:@radix-ui\/[\w-]+|radix-ui|@base-ui(?:-components)?\/react[\w/-]*|cmdk)['"]/g],
    description: 'Headless primitive imported directly — use the wrappers in @/ui/primitives (D-05).',
    exempt: [/^src\/ui\//, LEGACY_PRIMITIVES],
  },
  unstyledVariant: {
    patterns: [/variant=["']unstyled["']|variant:\s*['"]unstyled['"]/g],
    description: 'variant="unstyled" — add a real kit variant instead.',
  },
  literalInlineStyle: {
    // CLAUDE.md "inline style except for computed geometry": a style object with
    // a literal string or number value is not computed. `style={{ width }}`,
    // `style={{ height: rowHeight }}` and template literals pass. Hard-zero in
    // the new folders; the legacy count is informational until a later phase.
    patterns: [/style=\{\{[^}]*?:\s*(?:['"]|-?\d)/g],
    description: 'Inline style with a literal value — use design utilities; inline style is for computed geometry only.',
    files: /\.tsx$/,
    scope: 'new',
  },
  radixOverlaySelector: {
    // Count-only until P4 (D-19 replaces the Radix couplings with data-gai-overlay).
    patterns: [/data-radix-popper-content-wrapper|--radix-/g],
    description: 'Radix overlay coupling — use data-gai-overlay (D-19).',
    scope: 'new',
  },
};

// ── Scan ───────────────────────────────────────────────────────

function toPosix(p) {
  return p.split(sep).join('/');
}

function collectSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...collectSourceFiles(full));
    } else if (TS_AND_CSS.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(content, index) {
  let line = 1;
  for (let i = content.indexOf('\n'); i !== -1 && i < index; i = content.indexOf('\n', i + 1)) line++;
  return line;
}

/** @type {Record<string, { total: number, perFile: Record<string, number>, newFolder: string[] }>} */
const results = Object.fromEntries(
  Object.keys(RULES).map((name) => [name, { total: 0, perFile: {}, newFolder: [] }]),
);
/** file → content, kept for printing file:line of new occurrences */
const contents = new Map();

for (const full of collectSourceFiles(srcDir)) {
  const rel = toPosix(relative(webDir, full));
  if (GLOBAL_EXEMPT.some((re) => re.test(rel))) continue;
  const content = readFileSync(full, 'utf8');
  contents.set(rel, content);
  for (const [name, rule] of Object.entries(RULES)) {
    if (!(rule.files ?? TS_AND_CSS).test(rel)) continue;
    if (rule.exempt?.some((re) => re.test(rel))) continue;
    let n = 0;
    for (const re of rule.patterns) n += (content.match(re) ?? []).length;
    if (n === 0) continue;
    const r = results[name];
    r.total += n;
    r.perFile[rel] = n;
    if (NEW_FOLDERS.test(rel)) r.newFolder.push(...occurrences(name, rel));
  }
}

/** `file:line  match` for every occurrence of a rule in one file. */
function occurrences(name, rel) {
  const content = contents.get(rel) ?? '';
  const hits = [];
  for (const re of RULES[name].patterns) {
    for (const m of content.matchAll(re)) hits.push({ index: m.index, text: m[0] });
  }
  return hits.sort((a, b) => a.index - b.index).map((h) => `${rel}:${lineOf(content, h.index)}  ${h.text}`);
}

// ── Baseline ───────────────────────────────────────────────────

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

const ratchetRules = Object.keys(RULES).filter((n) => (RULES[n].scope ?? 'all') === 'all');

/** @type {{ counts: Record<string, number>, locked: string[] }} */
let baseline = readJson(baselinePath, { counts: {}, locked: [] });
/** @type {Record<string, Record<string, number>>} */
let filesBaseline = readJson(filesBaselinePath, {});

if (update) {
  const counts = {};
  const files = {};
  const locked = new Set(baseline.locked.filter((n) => ratchetRules.includes(n)));
  for (const name of ratchetRules) {
    if (locked.has(name)) continue;
    const was = baseline.counts[name];
    const now = results[name].total;
    // min(baseline, now): a rise keeps the old count AND the old per-file map.
    const lowered = was === undefined || now <= was;
    const count = lowered ? now : was;
    if (count === 0) {
      locked.add(name);
      continue;
    }
    counts[name] = count;
    files[name] = lowered ? sortKeys(results[name].perFile) : (filesBaseline[name] ?? {});
  }
  baseline = { counts, locked: ratchetRules.filter((n) => locked.has(n)) };
  filesBaseline = files;
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
  writeFileSync(filesBaselinePath, JSON.stringify(filesBaseline, null, 2) + '\n');
  console.log('[check-design-system] baseline updated (never raised); checking against it:\n');
}

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

// ── Report ─────────────────────────────────────────────────────

let failed = false;
const locked = new Set(baseline.locked);

/**
 * Line numbers added to a file relative to HEAD (`git diff -U0`), or null when
 * git cannot say (not a repository, or the rise is already committed — CI).
 * @type {Map<string, Set<number> | null>}
 */
const addedLinesCache = new Map();
function addedLines(rel) {
  if (addedLinesCache.has(rel)) return addedLinesCache.get(rel);
  let lines = null;
  try {
    const opts = { cwd: webDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    const tracked = execFileSync('git', ['ls-files', '--', rel], opts).trim() !== '';
    if (tracked) {
      const diff = execFileSync('git', ['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', rel], opts);
      const set = new Set();
      for (const [, start, count] of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
        for (let i = 0; i < Number(count ?? 1); i++) set.add(Number(start) + i);
      }
      lines = set.size > 0 ? set : null;
    }
  } catch {
    lines = null;
  }
  addedLinesCache.set(rel, lines);
  return lines;
}

/**
 * Occurrences in files whose count rose above the per-file baseline. The
 * `file (was → now)` summary comes first, so truncation cannot hide which files
 * rose; then each file's hits, narrowed to lines added since HEAD when git
 * knows them (otherwise every hit in the file).
 */
function newOccurrences(name, fileMap) {
  const summary = [];
  const details = [];
  for (const [rel, n] of Object.entries(results[name].perFile).sort(([a], [b]) => a.localeCompare(b))) {
    const was = fileMap[rel] ?? 0;
    if (n <= was) continue;
    summary.push(`${rel}  (${was} → ${n})`);
    const all = occurrences(name, rel);
    const added = addedLines(rel);
    const hits = added ? all.filter((o) => added.has(Number(/:(\d+) {2}/.exec(o)?.[1]))) : all;
    details.push(added ? `${rel}: hits on lines changed since HEAD` : `${rel}: every hit`);
    for (const o of hits.length > 0 ? hits : all) details.push(`  ${o}`);
  }
  return [...summary, ...details];
}

function printBlock(lines) {
  const MAX = 60;
  for (const l of lines.slice(0, MAX)) console.log(`             ${l}`);
  if (lines.length > MAX) console.log(`             … ${lines.length - MAX} more lines`);
}

for (const name of Object.keys(RULES)) {
  const rule = RULES[name];
  const now = results[name].total;
  const scope = rule.scope ?? 'all';

  if (scope === 'new') {
    console.log(`${'· info'.padEnd(12)} ${name}: ${now} in src (not ratcheted yet)`);
  } else if (locked.has(name)) {
    if (now > 0) {
      failed = true;
      console.log(`${'▲ FAIL'.padEnd(12)} ${name}: locked at 0 → ${now}`);
      console.log(`             ${rule.description}`);
      printBlock(newOccurrences(name, {}));
    } else {
      console.log(`${'· locked'.padEnd(12)} ${name}: 0`);
    }
  } else if (baseline.counts[name] === undefined) {
    failed = true;
    console.log(`${'▲ FAIL'.padEnd(12)} ${name}: no baseline (now ${now}) — run with --update once and commit it`);
  } else {
    const was = baseline.counts[name];
    if (now > was) {
      failed = true;
      console.log(`${'▲ FAIL'.padEnd(12)} ${name}: ${was} → ${now}`);
      console.log(`             ${rule.description}`);
      printBlock(newOccurrences(name, filesBaseline[name] ?? {}));
    } else if (now < was) {
      if (strict) failed = true;
      console.log(
        `${(strict ? '▼ FAIL' : '▼ improved').padEnd(12)} ${name}: ${was} → ${now}` +
          ' — run `pnpm --filter @generatorai/web check:design --update` and commit the lowered baseline',
      );
    } else {
      console.log(`${'· unchanged'.padEnd(12)} ${name}: ${now}`);
    }
  }

  const inNew = results[name].newFolder;
  if (inNew.length > 0) {
    failed = true;
    console.log(`${'▲ FAIL'.padEnd(12)} ${name}: ${inNew.length} in src/{ui,blocks,features,app} (must be 0)`);
    console.log(`             ${rule.description}`);
    printBlock(inNew);
  }
}

// ── Stories present (09 §3.6) ──────────────────────────────────

const missingStories = findMissingStories(webDir);
if (missingStories.length > 0) {
  failed = true;
  console.log(`\n${'▲ FAIL'.padEnd(12)} storiesPresent: ${missingStories.length} kit component file(s) without a sibling *.stories.tsx`);
  printBlock(missingStories);
} else {
  console.log(`\n${'· ok'.padEnd(12)} storiesPresent: every kit component has a story`);
}

if (failed) {
  console.error(
    '\n[check-design-system] FAILED. Fix the occurrences listed above (design utilities, kit primitives, ' +
      '@/ui/icons). If a count fell, lock it in with --update. See docs/redesign/09-verification.md §2.',
  );
  process.exit(1);
}

console.log('\n[check-design-system] OK.');

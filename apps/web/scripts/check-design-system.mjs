#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Design-system ratchet check.
//
// Greps apps/web/src for patterns the design system forbids
// (hardcoded palette classes, hand-rolled overlays, legacy .glass-*
// classes, raw <button>/<input> elements) and compares each count
// against the committed baseline in design-system-baseline.json.
//
// CI fails if ANY count RISES (new violations). Counts going down is
// the goal: after a cleanup PR, run with --update to lower the
// baseline. The baseline reaching ~0 is the Phase-5 exit criterion.
//
// Usage:
//   node scripts/check-design-system.mjs            # check (CI)
//   node scripts/check-design-system.mjs --update   # rewrite baseline
// ────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const srcDir = resolve(process.cwd(), 'src');
const baselinePath = resolve(process.cwd(), 'design-system-baseline.json');
const update = process.argv.includes('--update');

// Files that are allowed to contain the patterns (the primitives
// themselves + generated/vendored code).
const EXEMPT = [
  /[\\/]components[\\/]ui[\\/]/,
  /[\\/]styles[\\/]/,
  /\.test\.(ts|tsx)$/,
  /__tests__/,
];

/** name → { pattern, description } — counted per-match across all files */
const RULES = {
  hardcodedPaletteClass: {
    // bg-red-500, text-emerald-400, border-indigo-600, ring-rose-300 …
    pattern:
      /(?:bg|text|border|ring|fill|stroke|from|to|via|shadow|outline|decoration|divide|accent|caret)-(?:red|rose|pink|fuchsia|purple|violet|indigo|blue|sky|cyan|teal|emerald|green|lime|yellow|amber|orange|stone|neutral|zinc|gray|slate)-\d{2,3}\b/g,
    description: 'Hardcoded Tailwind palette class — use semantic tokens (bg-primary, text-muted-foreground, bg-success-muted…)',
  },
  handRolledOverlay: {
    pattern: /fixed inset-0/g,
    description: 'Hand-rolled overlay — use <Modal> / <ConfirmDialog> from @/components/ui',
  },
  legacyGlassClass: {
    pattern: /\b(?:glass-card|glass-btn|glass-input|glass-subtle|glass-strong|glass-header|glass-sidebar|btn-glow)\b/g,
    description: 'Legacy .glass-* / .btn-glow class — use ui primitives (Button, Card, Input, Toolbar)',
  },
  rawButtonElement: {
    pattern: /<button[\s>]/g,
    description: 'Raw <button> — use <Button> from @/components/ui',
  },
  rawInputElement: {
    pattern: /<(?:input|textarea|select)[\s>]/g,
    description: 'Raw <input>/<textarea>/<select> — use Input/Textarea/Select from @/components/ui',
  },
  adHocSpinner: {
    pattern: /Loader2[^\n]*animate-spin|animate-spin[^\n]*Loader2/g,
    description: 'Ad-hoc Loader2 spinner — use <Spinner> from @/components/ui',
  },
  nativeConfirm: {
    pattern: /\bwindow\.confirm\(|[^.\w]confirm\(/g,
    description: 'Native confirm() — use <ConfirmDialog>',
  },
};

function collectSourceFiles(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules') continue;
      out = out.concat(collectSourceFiles(full));
    } else if (/\.(tsx?|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = collectSourceFiles(srcDir).filter(
  (f) => !EXEMPT.some((re) => re.test(f)),
);

const counts = Object.fromEntries(Object.keys(RULES).map((k) => [k, 0]));
const worstFiles = Object.fromEntries(Object.keys(RULES).map((k) => [k, new Map()]));

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const [name, rule] of Object.entries(RULES)) {
    const matches = content.match(rule.pattern);
    if (matches) {
      counts[name] += matches.length;
      worstFiles[name].set(relative(process.cwd(), file), matches.length);
    }
  }
}

if (update) {
  writeFileSync(baselinePath, JSON.stringify(counts, null, 2) + '\n');
  console.log('[check-design-system] baseline updated:');
  console.log(JSON.stringify(counts, null, 2));
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
  console.error(`[check-design-system] missing baseline: ${baselinePath}`);
  console.error('Run `node scripts/check-design-system.mjs --update` once and commit it.');
  process.exit(2);
}

let failed = false;
for (const [name, rule] of Object.entries(RULES)) {
  const was = baseline[name] ?? 0;
  const now = counts[name];
  const arrow = now > was ? '▲ FAIL' : now < was ? '▼ improved' : '· unchanged';
  console.log(`${arrow.padEnd(12)} ${name}: ${was} → ${now}`);
  if (now > was) {
    failed = true;
    const top = [...worstFiles[name].entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`             ${rule.description}`);
    for (const [f, n] of top) console.log(`             ${n}× ${f}`);
  }
}

if (failed) {
  console.error(
    '\n[check-design-system] New design-system violations introduced. ' +
      'Use @/components/ui primitives and semantic tokens instead. ' +
      'If a count legitimately dropped elsewhere, run with --update to re-baseline.',
  );
  process.exit(1);
}

console.log('\n[check-design-system] OK — no new violations.');

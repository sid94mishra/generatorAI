#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Theme contrast audit — reads the SHIPPED token values out of
// src/styles/globals.css (every theme × light/dark) and computes WCAG 2.1
// contrast ratios for the pairs that matter for a form-heavy UI:
//
//   text      foreground / muted-foreground on background, card, subtle  ≥ 4.5
//   controls  input border on background and card                       ≥ 3.0  (1.4.11 non-text)
//   focus     ring on background                                        ≥ 3.0  (1.4.11)
//   borders   border on background                                      reported (decorative; no hard floor)
//
// Exit 1 when any hard threshold fails so it can gate CI.
//
//   node scripts/check-theme-contrast.mjs          # table
//   node scripts/check-theme-contrast.mjs --json
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');
const asJson = process.argv.includes('--json');

// ── colour maths (mirrors packages/design-tokens/src/color.ts) ──
function parse(hex) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m) return null;
  let b = m[1];
  if (b.length === 3 || b.length === 4) b = b.split('').map((c) => c + c).join('');
  return {
    r: parseInt(b.slice(0, 2), 16),
    g: parseInt(b.slice(2, 4), 16),
    b: parseInt(b.slice(4, 6), 16),
    a: b.length === 8 ? parseInt(b.slice(6, 8), 16) / 255 : 1,
  };
}
function lum({ r, g, b }) {
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function flatten(fg, bg) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}
function ratio(fgHex, bgHex) {
  const bg = parse(bgHex);
  let fg = parse(fgHex);
  if (!fg || !bg) return null;
  if (fg.a < 1) fg = flatten(fg, bg);
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// ── parse the generated layer into { selector → { var → value } } ──
const blocks = new Map();
const re = /([^{}]+)\{([^{}]*)\}/g;
let m;
while ((m = re.exec(css))) {
  const selector = m[1].trim().split('\n').pop().trim();
  const body = m[2].replace(/\/\*[\s\S]*?\*\//g, '');
  if (!/--background:/.test(body)) continue;
  const vars = {};
  for (const line of body.split(';')) {
    const kv = /^\s*--([\w-]+):\s*(.+)$/.exec(line.trim());
    if (kv) vars[kv[1]] = kv[2].trim();
  }
  blocks.set(selector, vars);
}

// Theme ids: `:root` is the default dark, `.light` default light, then
// [data-theme="x"] / .light[data-theme="x"].
const themes = [];
for (const [selector, vars] of blocks) {
  if (selector === ':root') themes.push({ theme: 'github', appearance: 'dark', vars });
  else if (selector === '.light') themes.push({ theme: 'github', appearance: 'light', vars });
  else {
    const t = /^(\.light)?\[data-theme="([^"]+)"\]$/.exec(selector);
    if (t) themes.push({ theme: t[2], appearance: t[1] ? 'light' : 'dark', vars });
  }
}

const CHECKS = [
  { id: 'fg/bg', fg: 'foreground', bg: 'background', min: 4.5 },
  { id: 'fg/card', fg: 'foreground', bg: 'card', min: 4.5 },
  { id: 'fg/subtle', fg: 'foreground', bg: 'subtle', min: 4.5 },
  { id: 'muted/bg', fg: 'muted-foreground', bg: 'background', min: 4.5 },
  { id: 'muted/card', fg: 'muted-foreground', bg: 'card', min: 4.5 },
  { id: 'muted/subtle', fg: 'muted-foreground', bg: 'subtle', min: 4.5 },
  { id: 'input/bg', fg: 'input', bg: 'background', min: 3 },
  { id: 'input/card', fg: 'input', bg: 'card', min: 3 },
  { id: 'ring/bg', fg: 'ring', bg: 'background', min: 3 },
  { id: 'border/bg', fg: 'border', bg: 'background', min: null },
  { id: 'placeholder/bg', fg: 'muted-foreground', bg: 'background', min: 4.5 },
];

const rows = [];
let failing = 0;
for (const { theme, appearance, vars } of themes) {
  const row = { theme, appearance, results: {}, fails: [] };
  for (const c of CHECKS) {
    const r = ratio(vars[c.fg] ?? '', vars[c.bg] ?? '');
    row.results[c.id] = r;
    if (c.min !== null && (r === null || r < c.min)) row.fails.push(`${c.id}=${r?.toFixed(2) ?? '?'}<${c.min}`);
  }
  if (row.fails.length) failing += 1;
  rows.push(row);
}

if (asJson) {
  console.log(JSON.stringify({ variants: rows.length, failing, rows }, null, 2));
} else {
  const ids = CHECKS.map((c) => c.id);
  console.log(`[check-theme-contrast] ${rows.length} theme variants, ${failing} with failures\n`);
  console.log(['theme'.padEnd(22), ...ids.map((i) => i.padStart(12))].join(''));
  for (const row of rows) {
    console.log(
      [
        `${row.theme}/${row.appearance}`.padEnd(22),
        ...ids.map((i) => (row.results[i] === null ? '?' : row.results[i].toFixed(2)).padStart(12)),
      ].join('') + (row.fails.length ? `   FAIL ${row.fails.join(', ')}` : ''),
    );
  }
}

if (failing > 0) process.exit(1);

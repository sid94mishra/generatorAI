#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Bundle hygiene gate for the phone.
//
// A phone is not a desktop. Every module Metro bundles is parsed and held by
// Hermes on a device with a fraction of a laptop's memory, so server-side
// code has no business there. This script reads the source map of an
// `expo export` and fails when anything from the forbidden list is present,
// and prints a per-package size table so a regression is visible in review.
//
// Usage:
//   pnpm --filter @generatorai/mobile bundle:check          (exports, then checks)
//   node scripts/check-bundle.mjs <path/to/entry.hbc.map>   (check an existing map)
//
// Sizes are pre-minification source bytes from `sourcesContent` — a stable
// proxy that does not depend on Hermes bytecode layout.
// ────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const exportDir = path.join(appRoot, '.expo-export');

/** Anything matching these must NOT be in the phone bundle. */
const FORBIDDEN = [
  { pattern: /packages\/shared\/src\/config\/AppConfig\.ts/, why: 'server app-config schema' },
  { pattern: /packages\/shared\/src\/config\/childEnv\.ts/, why: 'child-process env allow-list (server)' },
  { pattern: /packages\/shared\/src\/ipc\//, why: 'host IPC protocols (server ↔ hosts)' },
  { pattern: /packages\/shared\/src\/telemetry\//, why: 'OpenTelemetry (server)' },
  { pattern: /packages\/shared\/src\/logging\//, why: 'pino logger factory (server)' },
  { pattern: /packages\/shared\/src\/node\.ts/, why: 'node-only shared entry' },
  { pattern: /packages\/shared\/src\/builders\//, why: 'workflow builders (server)' },
  { pattern: /packages\/(auth|core|db|secrets|changes|checkpoints|cli-core|agent-harness-providers)\//, why: 'server package' },
  { pattern: /apps\/(server|relay|desktop|web|cli|.*-host)\//, why: 'another app' },
  { pattern: /node_modules\/(pino|pino-roll|sonic-boom|thread-stream)\b/, why: 'server logger' },
  { pattern: /node_modules\/@opentelemetry\//, why: 'server telemetry' },
  { pattern: /node_modules\/(express|better-sqlite3|ws|node-pty|playwright)\b/, why: 'server runtime' },
  { pattern: /node_modules\/@gorhom\//, why: 'removed sheet library' },
  { pattern: /node_modules\/@shopify\/react-native-skia\//, why: 'removed (native 10 MB, unused)' },
];

// Note: `semver` still appears via react-native-reanimated's own
// `scripts/validate-worklets-version.js` (a 45 KB dev-time check the library
// imports at runtime); it is not ours and is tolerated.

/** Per-package source-size ceilings (bytes of source). */
const CEILINGS = {
  'lucide-react-native': 200_000,
  'workspace:shared': 200_000,
};

function packageKey(source) {
  const s = source.split('\\').join('/');
  const m = s.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@[^/]+\/[^/]+|[^/]+)/);
  if (s.includes('/packages/')) return 'workspace:' + s.match(/\/packages\/([^/]+)/)[1];
  if (s.includes('/apps/mobile/')) return 'app';
  return m ? m[1] : s;
}

function findMap() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  const dir = path.join(exportDir, '_expo/static/js/android');
  if (!fs.existsSync(dir)) {
    console.log('▸ no export found, running `expo export --platform android --source-maps`…');
    const r = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['expo', 'export', '--platform', 'android', '--output-dir', '.expo-export', '--source-maps'],
      { cwd: appRoot, stdio: 'inherit', shell: process.platform === 'win32' },
    );
    if (r.status !== 0) {
      console.error('expo export failed');
      process.exit(r.status ?? 1);
    }
  }
  const map = fs.readdirSync(dir).find((f) => f.endsWith('.hbc.map') || f.endsWith('.js.map'));
  if (!map) throw new Error(`no source map in ${dir}`);
  return path.join(dir, map);
}

const mapPath = findMap();
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const sources = map.sources ?? [];
const contents = map.sourcesContent ?? [];

const byPkg = new Map();
const violations = [];
let total = 0;
for (let i = 0; i < sources.length; i++) {
  const src = String(sources[i]).split('\\').join('/');
  const size = contents[i] ? contents[i].length : 0;
  total += size;
  const key = packageKey(src);
  byPkg.set(key, (byPkg.get(key) ?? 0) + size);
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(src)) violations.push({ src: src.replace(/.*\/(node_modules|packages|apps)\//, '$1/'), why: rule.why });
  }
}

const bundleDir = path.dirname(mapPath);
const bundleFile = fs.readdirSync(bundleDir).find((f) => f.endsWith('.hbc') || (f.endsWith('.js') && !f.endsWith('.map')));
const bundleBytes = bundleFile ? fs.statSync(path.join(bundleDir, bundleFile)).size : 0;

console.log(`\nBundle: ${bundleFile ?? '?'}  ${(bundleBytes / 1024 / 1024).toFixed(2)} MB   modules: ${sources.length}   source: ${(total / 1024 / 1024).toFixed(2)} MB\n`);
console.log('  bytes   share  package');
for (const [k, v] of [...byPkg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(String(v).padStart(9), ((100 * v) / total).toFixed(1).padStart(5) + '%', k);
}

let failed = false;
for (const [pkg, ceiling] of Object.entries(CEILINGS)) {
  const actual = byPkg.get(pkg) ?? 0;
  if (actual > ceiling) {
    failed = true;
    console.error(`\n✗ ${pkg}: ${actual} bytes of source exceeds ceiling ${ceiling}`);
  }
}
if (violations.length > 0) {
  failed = true;
  console.error(`\n✗ ${violations.length} server-side module(s) in the phone bundle:`);
  for (const v of violations.slice(0, 40)) console.error(`   ${v.src}   ← ${v.why}`);
  if (violations.length > 40) console.error(`   … and ${violations.length - 40} more`);
}
if (failed) process.exit(1);
console.log('\n✓ bundle is clean: no server-side modules, all package ceilings respected');

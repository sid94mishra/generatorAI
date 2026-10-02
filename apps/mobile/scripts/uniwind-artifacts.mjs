#!/usr/bin/env node
// Writes Uniwind's build artifacts without Metro (MD-118): the theme variants inside
// node_modules/uniwind/uniwind.css (what `@import 'uniwind'` in global.css loads) and
// src/theme/uniwind-types.d.ts. Metro's withUniwindConfig writes the same files on start;
// ESLint (better-tailwindcss reads global.css with plain Tailwind) and tsc run without Metro,
// so `lint` / `check:design` / `typecheck` call this first. Idempotent: Uniwind rewrites a file
// only when its content changes.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(mobileDir, 'package.json'));
const cli = join(dirname(require.resolve('uniwind/package.json')), 'dist/cli/index.mjs');
const themes = JSON.parse(readFileSync(join(mobileDir, 'src/theme/uniwind-themes.json'), 'utf8'));

const args = [cli, 'generate-artifacts', '--css', './src/theme/global.css', '--dts', './src/theme/uniwind-types.d.ts'];
for (const theme of themes) args.push('--theme', theme);
const result = spawnSync(process.execPath, args, { cwd: mobileDir, stdio: ['ignore', 'ignore', 'inherit'] });
if (result.status !== 0) {
  console.error('uniwind generate-artifacts failed');
  process.exit(result.status ?? 1);
}

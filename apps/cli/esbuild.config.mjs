// ────────────────────────────────────────────────────────────────
// Bundles the CLI into ONE self-contained ESM file.
//
// Same reasoning as the server bundle (see apps/server/esbuild.config.mjs):
// `tsc` leaves `import '@generatorai/core'` untouched, and those packages
// only exist as pnpm workspace symlinks. A `tsc`-only build is therefore
// unusable outside this repo — `npm i -g` would install a CLI that cannot
// start.
//
// The `dev`/`cli` scripts still run the TypeScript sources through tsx; this
// is strictly a distribution artifact.
// ────────────────────────────────────────────────────────────────

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));

/**
 * Left out of the bundle.
 *
 *   better-sqlite3   Native `.node` addon, reached through `@generatorai/db`
 *                    when the CLI runs in `--local` (in-process) mode.
 *   node-pty         Native `.node` addon.
 *   playwright       Resolves its driver through package-relative paths.
 *
 * These stay real npm dependencies so a consumer's install fetches the right
 * prebuilt binary for their platform.
 */
const EXTERNAL = ['better-sqlite3', 'node-pty', 'playwright', 'playwright-core'];

/**
 * ESM interop shim: bundled CommonJS dependencies call `require()`, which
 * does not exist in an ESM module scope.
 *
 * Deliberately does NOT include `#!/usr/bin/env node`. `src/index.tsx`
 * already starts with that line and esbuild hoists an entry point's hashbang
 * to the top of the output, so adding it here produces a *second* shebang on
 * line 2 — which is a syntax error, not a comment.
 */
const BANNER = [
  "import { createRequire as __createRequire } from 'node:module';",
  "import { fileURLToPath as __fileURLToPath } from 'node:url';",
  "import { dirname as __pathDirname } from 'node:path';",
  'const require = __createRequire(import.meta.url);',
  'const __filename = __fileURLToPath(import.meta.url);',
  'const __dirname = __pathDirname(__filename);',
].join('\n');

const result = await build({
  entryPoints: [path.join(here, 'src', 'index.tsx')],
  outfile: path.join(here, 'dist-bundle', 'generatorai.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: EXTERNAL,
  banner: { js: BANNER },
  // Single source of truth for the version users see. Reading package.json at
  // runtime is not an option — the published artifact is one loose file with
  // no manifest beside it.
  define: { __CLI_VERSION__: JSON.stringify(version) },
  // The CLI renders with Ink (React), so JSX has to be transformed.
  jsx: 'automatic',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.log(`[bundle] generatorai.mjs v${version} — ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`[bundle] external (real npm deps): ${EXTERNAL.join(', ')}`);

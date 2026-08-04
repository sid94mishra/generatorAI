// ────────────────────────────────────────────────────────────────
// Bundles the server into ONE self-contained ESM file for distribution.
//
// Why bundle at all: `tsc` transpiles but does not resolve. Its output keeps
// every `import 'express'` / `import '@generatorai/core'` intact, so running
// it requires the full `node_modules` tree AND the monorepo's `workspace:*`
// symlinks. The desktop installer ships neither — it copies `dist/` alone —
// so a `tsc`-only build dies on its first import inside a packaged app.
//
// Bundling inlines all of that, which also sidesteps pnpm's symlinked store
// (a plain file copy of `node_modules` would be a tree of dangling links).
//
// The `dev`/`start` scripts still use the plain `tsc` output; this is
// strictly a packaging artifact.
// ────────────────────────────────────────────────────────────────

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { BUNDLE_EXTERNALS } from './bundle-externals.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * ESM output has no `require`, `__filename` or `__dirname`, but plenty of our
 * CommonJS dependencies (express among them) call `require()` internally.
 * Without this shim the bundle builds cleanly and then dies at runtime with
 * `Dynamic require of "node:events" is not supported`.
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
  entryPoints: [path.join(here, 'src', 'index.ts')],
  outfile: path.join(here, 'dist-bundle', 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: BUNDLE_EXTERNALS,
  banner: { js: BANNER },
  sourcemap: true,
  // Minification is skipped on purpose: it saves little on a mostly-inlined
  // dependency tree and makes production stack traces far harder to read.
  minify: false,
  logLevel: 'info',
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.log(`[bundle] server.mjs — ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`[bundle] external (shipped separately): ${BUNDLE_EXTERNALS.join(', ')}`);

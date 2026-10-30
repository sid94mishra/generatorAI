// ────────────────────────────────────────────────────────────────
// Bundles `generatorai-mcp` into ONE self-contained ESM file.
//
// Same reasoning as the CLI bundle (apps/cli/esbuild.config.mjs): the
// workspace packages this imports export TypeScript source, so neither
// `node src/cli.ts` nor a `tsc` build can start outside a TypeScript runner
// (CONVINV-R14). The bundle inlines them, and `bin` points at it.
// ────────────────────────────────────────────────────────────────

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(here, 'dist-bundle');

/**
 * ESM interop shim: bundled CommonJS dependencies call `require()`, which
 * does not exist in an ESM module scope. No hashbang here: `src/cli.ts`
 * starts with one and esbuild hoists it to the top of the output.
 */
const BANNER = [
  "import { createRequire as __createRequire } from 'node:module';",
  "import { fileURLToPath as __fileURLToPath } from 'node:url';",
  "import { dirname as __pathDirname } from 'node:path';",
  'const require = __createRequire(import.meta.url);',
  'const __filename = __fileURLToPath(import.meta.url);',
  'const __dirname = __pathDirname(__filename);',
].join('\n');

fs.rmSync(outdir, { recursive: true, force: true });

const result = await build({
  entryPoints: [path.join(here, 'src', 'cli.ts')],
  outfile: path.join(outdir, 'generatorai-mcp.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: { js: BANNER },
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.log(`[bundle] generatorai-mcp.mjs — ${(bytes / 1024 / 1024).toFixed(2)} MB`);

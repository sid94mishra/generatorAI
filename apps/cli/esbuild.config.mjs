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
 * Nothing is left out of the bundle.
 *
 * The CLI is a pure HTTP/WebSocket client of a running server: it never opens
 * the database, spawns a PTY or launches a browser itself, so it needs no
 * native `.node` addon and no browser download. An earlier build kept
 * `better-sqlite3`, `node-pty` and `playwright` external "for `--local`
 * (in-process) mode" — a mode that never existed in this tree. Should a future
 * import reach one of them, esbuild fails to resolve it against
 * `apps/cli/package.json`, which is the failure we want.
 */
const EXTERNAL = [];

/**
 * `react-devtools-core` is a DEVELOPMENT dependency of Ink: it is imported
 * unconditionally but only used when `DEV` is set. Bundling it costs 680 KB
 * of parse time in every distributed binary for a code path a released CLI
 * never takes, so it is stubbed out rather than shipped.
 */
const STUB_DEV_TOOLS = {
  name: 'stub-react-devtools',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'react-devtools-core',
      namespace: 'stub',
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: [
        'export function connectToDevTools() {}',
        'export default { connectToDevTools };',
      ].join('\n'),
      loader: 'js',
    }));
  },
};

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

// Code splitting, so the TUI's dependency tree is not paid for by
// `generatorai --version` (open question #35).
//
// `src/index.tsx` already loads the workbench through `await
// import('./tui/launch.js')` — but a SINGLE-FILE bundle has nowhere to put a
// separate chunk, so esbuild inlines it and the dynamic import buys nothing
// at runtime. Measured, that was ~4 MB of TUI-only code (highlight.js 1.4 MB,
// react-reconciler 1.1 MB, react-devtools-core 0.7 MB, parse5, yoga-layout,
// @xterm/headless, ink, react) evaluated before printing a version string.
//
// `splitting: true` needs `outdir` rather than `outfile`; the `files` entry in
// package.json ships the compiled `.mjs` from that directory, so the extra
// chunks travel with it, and `bin` still points at `generatorai.mjs`.
const outdir = path.join(here, 'dist-bundle');

// Wipe the directory first. Chunk names carry a content hash, so a rebuild
// writes NEW files and leaves the previous build's chunks sitting there
// forever — and `files` ships whatever it finds. A directory that had
// accumulated across builds measured 128 MB against 18 MB for a clean one,
// and packed a 27 MB tarball full of chunks nothing referenced any more. CI
// never saw it because a fresh checkout has no stale output; a publish run
// from a working machine would have shipped all of it.
fs.rmSync(outdir, { recursive: true, force: true });

const result = await build({
  entryPoints: [path.join(here, 'src', 'index.tsx')],
  outdir,
  entryNames: 'generatorai',
  chunkNames: 'chunks/[name]-[hash]',
  // `bin` points at `generatorai.mjs`, and Node needs the extension to treat
  // a file as ESM outside a `type: module` package.
  outExtension: { '.js': '.mjs' },
  splitting: true,
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
  plugins: [STUB_DEV_TOOLS],
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.log(`[bundle] generatorai.mjs v${version} — ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(
  `[bundle] external (real npm deps): ${EXTERNAL.length === 0 ? 'none — self-contained' : EXTERNAL.join(', ')}`,
);

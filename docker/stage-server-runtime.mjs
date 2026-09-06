#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Assembles the runtime directory that `docker/server.Dockerfile` copies into
// its final stage. Run inside the builder stage, after
// `pnpm --filter @generatorai/server bundle`.
//
//   <out>/server.mjs (+ .map)   the esbuild bundle
//   <out>/node_modules/         ONLY the packages the bundle leaves external
//   <out>/web/                  the built SPA (served via WEB_DIST_DIR)
//   <out>/templates/            bundled workflow templates (TEMPLATES_DIR)
//
// The external list and the reasons behind it live in ONE place —
// `apps/server/bundle-externals.mjs` — and this script reads it rather than
// keeping a copy, for the same reason that file exists at all: a package added
// to the bundle's `external` and forgotten here builds cleanly and dies at
// runtime on the first import.
//
// The tree is produced by running `pnpm install` against a generated manifest
// pinned to the versions the monorepo resolved, NOT by copying out of the
// monorepo's symlinked store. `apps/desktop/scripts/stage-server-runtime.mjs`
// does the same for the packaged desktop app and explains why at length; the
// one difference here is that native addons are built for the container's
// own Node ABI, so none of the Electron `npm_config_*` overrides apply.
//
// Usage: node docker/stage-server-runtime.mjs <outDir>
// ────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const serverRoot = path.join(repoRoot, 'apps', 'server');
const coreRoot = path.join(repoRoot, 'packages', 'core');

const outDir = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
if (!outDir) {
  console.error('usage: node docker/stage-server-runtime.mjs <outDir>');
  process.exit(2);
}

const { RUNTIME_PACKAGES } = await import(path.join(serverRoot, 'bundle-externals.mjs'));

/** Resolve the version the monorepo actually installed for `name`. */
function installedVersion(name) {
  for (const from of [serverRoot, coreRoot]) {
    try {
      const req = createRequire(path.join(from, 'package.json'));
      // `exports` maps may hide package.json; resolve the package dir instead.
      const entry = req.resolve(name);
      let dir = path.dirname(entry);
      while (dir !== path.dirname(dir)) {
        const pj = path.join(dir, 'package.json');
        if (fs.existsSync(pj)) {
          const parsed = JSON.parse(fs.readFileSync(pj, 'utf8'));
          if (parsed.name === name) return parsed.version;
        }
        dir = path.dirname(dir);
      }
    } catch {
      // try the next root
    }
  }
  throw new Error(`${name} is not installed in apps/server or packages/core — run pnpm install first`);
}

function copyRequired(from, to, what) {
  if (!fs.existsSync(from)) {
    throw new Error(`${what} not found at ${from} — build it before staging`);
  }
  fs.cpSync(from, to, { recursive: true });
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const bundle = path.join(serverRoot, 'dist-bundle', 'server.mjs');
copyRequired(bundle, path.join(outDir, 'server.mjs'), 'server bundle');
if (fs.existsSync(`${bundle}.map`)) fs.copyFileSync(`${bundle}.map`, path.join(outDir, 'server.mjs.map'));
copyRequired(path.join(repoRoot, 'apps', 'web', 'dist'), path.join(outDir, 'web'), 'web build');
copyRequired(path.join(repoRoot, 'templates'), path.join(outDir, 'templates'), 'templates directory');

const dependencies = Object.fromEntries(RUNTIME_PACKAGES.map((name) => [name, installedVersion(name)]));
const manifest = {
  name: 'generatorai-server-runtime',
  private: true,
  type: 'module',
  dependencies,
  pnpm: {
    // pnpm 10 refuses to run install scripts it has not been told about, and
    // the native addons below are exactly the packages that need them.
    onlyBuiltDependencies: RUNTIME_PACKAGES,
  },
};
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('[stage-runtime] externals:', dependencies);

const install = spawnSync(
  'pnpm',
  ['install', '--prod', '--node-linker=hoisted', '--ignore-workspace', '--config.confirmModulesPurge=false'],
  { cwd: outDir, stdio: 'inherit', shell: process.platform === 'win32' },
);
if (install.status !== 0) {
  console.error(`[stage-runtime] pnpm install failed in ${outDir} (exit ${install.status})`);
  process.exit(1);
}
// Not needed at runtime and confuses `pnpm` inside the container into
// thinking /app is a project to manage.
for (const f of ['pnpm-lock.yaml', '.modules.yaml', '.pnpm-workspace-state-v1.json']) {
  fs.rmSync(path.join(outDir, f), { force: true });
}
console.log(`[stage-runtime] ready: ${outDir}`);

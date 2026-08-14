// ────────────────────────────────────────────────────────────────
// Produces the production `node_modules` that ships beside the server bundle.
//
// esbuild leaves a few packages out of the bundle (native `.node` addons, and
// Playwright, which resolves its driver through package-relative paths), so
// those still have to be importable at runtime. Node resolves a bare ESM
// specifier by walking UP from the importing file looking for `node_modules`,
// and the packaged layout is:
//
//     resources/server/server.mjs        ← the bundle
//     resources/server/node_modules/     ← this directory
//     app.asar/                          ← unreachable from the line above
//
// so writing the packages here puts them on the first rung of the lookup.
// (`NODE_PATH` is not an alternative — Node ignores it for ESM.)
//
// The tree is produced by running `pnpm install` against a generated manifest,
// NOT by copying out of the monorepo. Copying means reimplementing module
// resolution — transitive dependencies, `optionalDependencies`, platform
// filtering, `exports` maps — and every subtle mistake yields an app that runs
// on the build machine and nowhere else. pnpm already knows all of this.
//
// Three settings do the real work:
//
//   --node-linker=hoisted   pnpm's default tree is symlinks into a content-
//                           addressed store. An installer that copies those
//                           ships dangling links, so ask for real directories.
//
//   --ignore-workspace      this directory sits inside the monorepo; without
//                           the flag pnpm walks up, finds the root
//                           `pnpm-workspace.yaml` and installs the wrong tree.
//
//   npm_config_runtime      the server is spawned with ELECTRON_RUN_AS_NODE=1,
//   npm_config_target       so native addons must match *Electron's* ABI, not
//   npm_config_disturl      the system Node's. These are what `prebuild-install`
//                           (and node-gyp, if it falls through to a source
//                           build) read to fetch the right binary.
//
// One packaging constraint leaks out of here: electron-builder 26 refuses to
// copy a directory literally named `node_modules` from the root of an
// `extraResources` entry (app-builder-lib's createFilter returns false for it
// unconditionally — v25 did not). `apps/desktop/package.json` therefore maps
// this directory with a second, explicit entry whose `from` IS the
// `node_modules` directory, so the name never appears as a relative path.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { RUNTIME_PACKAGES, ABI_SENSITIVE_PACKAGES, NATIVE_PACKAGES, driverPlatformPackage } from '../../server/bundle-externals.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const stageDir = path.resolve(desktopRoot, '..', 'server', 'dist-bundle');
const nodeModules = path.join(stageDir, 'node_modules');

const require = createRequire(path.join(desktopRoot, 'package.json'));

function fail(message) {
  console.error(`[stage] ${message}`);
  process.exit(1);
}

/** The version installed in the workspace, so the staged tree matches what the test run exercised. */
function installedVersion(name) {
  try {
    return JSON.parse(fs.readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version;
  } catch {
    return fail(`${name} is not installed in apps/desktop — run \`pnpm install\` first.`);
  }
}

const electronVersion = installedVersion('electron');

// Native binaries are per-architecture, so a foreign-arch build would silently
// stage the host's. Refuse rather than produce that.
const targetPlatform = process.env['GENERATORAI_STAGE_PLATFORM'] ?? process.platform;
const targetArch = process.env['GENERATORAI_STAGE_ARCH'] ?? process.arch;
if (targetArch === 'universal') {
  fail('universal is not an install target — stage arm64 and x64 separately, then merge.');
}

if (!fs.existsSync(path.join(stageDir, 'server.mjs'))) {
  fail(`${stageDir}/server.mjs missing — run \`pnpm --filter @generatorai/server bundle\` first.`);
}

// ── Generate the manifest ────────────────────────────────────────
// Exact versions, not ranges: the packaged app should contain the code the
// test run exercised, not whatever floats to the top on release day.
fs.writeFileSync(
  path.join(stageDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'generatorai-server-runtime',
      version: '0.0.0',
      private: true,
      description: 'Runtime dependencies for the packaged GeneratorAI server bundle.',
      // Read back by the packaging step, which refuses to build an installer
      // for an architecture these binaries were not compiled for.
      generatoraiStage: { platform: targetPlatform, arch: targetArch },
      dependencies: Object.fromEntries(
        RUNTIME_PACKAGES.map((name) => [name, installedVersion(name)]),
      ),
      pnpm: {
        // pnpm 10 refuses to run install scripts unless a package is listed
        // here, and these need theirs to obtain a native binary.
        onlyBuiltDependencies: [...ABI_SENSITIVE_PACKAGES, 'node-pty'],
        supportedArchitectures: { os: [targetPlatform], cpu: [targetArch] },
      },
    },
    null,
    2,
  )}\n`,
);

// ── Install ──────────────────────────────────────────────────────
fs.rmSync(nodeModules, { recursive: true, force: true });

console.log(
  `[stage] installing ${RUNTIME_PACKAGES.length} runtime packages for electron@${electronVersion} ${targetPlatform}-${targetArch}`,
);

const install = spawnSync(
  // Passed as one string rather than command + args: `pnpm` is a `.cmd` shim on
  // Windows, which Node will only spawn through a shell, and the shell form
  // with a separate args array is deprecated (DEP0190). Every token below is a
  // literal, so there is nothing for the shell to interpolate.
  [
    'pnpm install',
    '--prod',
    '--ignore-workspace',
    '--no-lockfile',
    '--node-linker=hoisted',
    '--config.confirmModulesPurge=false',
  ].join(' '),
  {
    cwd: stageDir,
    env: {
      ...process.env,
      npm_config_runtime: 'electron',
      npm_config_target: electronVersion,
      npm_config_disturl: 'https://electronjs.org/headers',
      npm_config_platform: targetPlatform,
      npm_config_arch: targetArch,
    },
    stdio: 'inherit',
    shell: true,
  },
);

if (install.status !== 0) {
  fail(`pnpm install failed in ${stageDir} (exit ${install.status}).`);
}

// ── Verify ───────────────────────────────────────────────────────
// A mis-staged tree installs cleanly and fails on first use inside the packaged
// app, which is a long way from here. Check the invariants while it is cheap.
for (const name of RUNTIME_PACKAGES) {
  if (!fs.existsSync(path.join(nodeModules, name, 'package.json'))) {
    fail(`${name} is missing from the staged tree.`);
  }
}

for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
  if (entry.isSymbolicLink()) {
    fail(`${entry.name} was staged as a symlink — the installer would ship a dangling link.`);
  }
}

for (const name of ABI_SENSITIVE_PACKAGES) {
  const binary = path.join(nodeModules, name, 'build', 'Release', `${name.replace(/-/g, '_')}.node`);
  if (!fs.existsSync(binary)) {
    fail(
      `${name} has no compiled binary at ${path.relative(stageDir, binary)}.\n` +
        `        The packaged app would install and then fail on first database access.`,
    );
  }
}

// A native package can arrive with a vendored prebuild or be compiled during
// install, and which one happens is platform-dependent. Either is fine; having
// neither is not, and pnpm does not treat a failed optional build as an error.
for (const name of NATIVE_PACKAGES) {
  const pkg = path.join(nodeModules, name);
  const compiled = path.join(pkg, 'build', 'Release');
  const prebuild = path.join(pkg, 'prebuilds', `${targetPlatform}-${targetArch}`);

  const hasBinary = [compiled, prebuild].some(
    (dir) =>
      fs.existsSync(dir) &&
      fs
        .readdirSync(dir, { recursive: true, withFileTypes: true })
        .some((entry) => entry.isFile() && entry.name.endsWith('.node')),
  );

  if (!hasBinary) {
    fail(
      `${name} has no .node binary for ${targetPlatform}-${targetArch}.\n` +
        `        Looked in build/Release and prebuilds/${targetPlatform}-${targetArch}.\n` +
        `        node-pty ships no Linux prebuild, so a Linux build needs python3 and a C++ toolchain.`,
    );
  }
}

// The driver's library lives in a per-target optional dependency, so the loop
// above cannot see it. A wrong-target stage installs cleanly and then fails on
// the first computer-use call.
const driver = driverPlatformPackage(targetPlatform, targetArch);
const driverLib = path.join(nodeModules, driver.name, driver.lib);
if (!fs.existsSync(path.join(nodeModules, '@trycua', 'cua-driver', 'package.json'))) {
  fail('@trycua/cua-driver is missing from the staged tree; computer use would be unavailable.');
}
if (!fs.existsSync(driverLib)) {
  fail(
    `${driver.name} has no ${driver.lib} for ${targetPlatform}-${targetArch}.\n` +
      `        Looked at ${path.relative(stageDir, driverLib)}.`,
  );
}

const staged = fs.readdirSync(nodeModules).filter((name) => !name.startsWith('.'));
console.log(
  `[stage] ${staged.length} packages staged into ${path.relative(process.cwd(), nodeModules)}`,
);
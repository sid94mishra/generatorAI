// ────────────────────────────────────────────────────────────────
// Runs electron-builder with a generated configuration and a sanitised
// environment.
//
// Two things happen here that electron-builder will not do for us:
//
//   Empty variables are removed. electron-builder treats several variables as
//   "configured" when they are set but empty, and `CSC_LINK: ${{ secrets.X }}`
//   expands to exactly that in GitHub Actions when the secret does not exist.
//   The result is a signing failure on a build nobody asked to sign.
//
//   The update manifest is withdrawn when it cannot be honoured. Squirrel.Mac
//   refuses updates it cannot validate, so an unsigned macOS build must not
//   advertise one.
//
// Anything passed on the command line is forwarded untouched.
// ────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPublishAllowed,
  createBuildConfig,
  resolveChannel,
  resolveSigning,
  unpublishableManifests,
  PartialSigningConfigError,
  UnsignedPublishError,
} from './lib/build-config.mjs';

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

function fail(message) {
  console.error(`[electron-builder] ${message}`);
  process.exit(1);
}

// ── Environment ──────────────────────────────────────────────────
const env = { ...process.env };
const scrubbed = [];
for (const [key, value] of Object.entries(env)) {
  if (value === '') {
    delete env[key];
    scrubbed.push(key);
  }
}
if (scrubbed.length > 0) {
  console.log(
    `[electron-builder] ignoring ${scrubbed.length} empty env vars: ${scrubbed.join(', ')}`,
  );
}

// ── Target ───────────────────────────────────────────────────────
const HOST_PLATFORM = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
const platform = ['win', 'mac', 'linux'].find((p) => argv.includes(`--${p}`)) ?? HOST_PLATFORM;
if (!platform) fail(`unsupported host platform ${process.platform}`);

// The staged tree is compiled for one architecture. Building an installer for
// any other ships native modules that cannot load — silently, because nothing
// touches the database until the app is already installed.
const stageManifest = path.resolve(desktopRoot, '..', 'server', 'dist-bundle', 'package.json');
if (!existsSync(stageManifest)) {
  fail('server runtime has not been staged — run `pnpm run build:server` first.');
}
const stage = JSON.parse(readFileSync(stageManifest, 'utf8')).generatoraiStage;
if (!stage) {
  fail('staged server runtime predates architecture tracking — re-run `pnpm run build:server`.');
}
const stagePlatform = { win: 'win32', mac: 'darwin', linux: 'linux' }[platform];
if (stage.platform !== stagePlatform) {
  fail(
    `server runtime was staged for ${stage.platform}, but this is a ${platform} build.\n` +
      `        Re-run \`pnpm run build:server\` on the target platform.`,
  );
}

const requestedArch = ['x64', 'arm64', 'universal'].find((a) => argv.includes(`--${a}`));
if (requestedArch && requestedArch !== stage.arch) {
  fail(
    `--${requestedArch} was requested but the server runtime is staged for ${stage.arch}.\n` +
      `        Set GENERATORAI_STAGE_ARCH=${requestedArch} and re-run \`pnpm run build:server\`.`,
  );
}

// The SDK verifies contract and capability versions against the daemon and
// refuses before dispatch, so a driver that disagrees with the installed npm
// package disables computer use entirely — silently, and everywhere at once.
const driverTarget = `${{ win: 'win32', mac: 'darwin', linux: 'linux' }[platform]}-${stage.arch}`;
const driverDir = path.join(desktopRoot, 'resources', 'cua-driver', driverTarget);
const driverStamp = path.join(driverDir, '.version');
if (!existsSync(driverStamp)) {
  fail(
    `the cua-driver payload for ${driverTarget} has not been staged.\n` +
      `        Run \`node scripts/fetch-cua-driver.mjs\` first.`,
  );
}
const sdkVersion = JSON.parse(
  readFileSync(path.resolve(desktopRoot, '..', '..', 'node_modules', '@trycua', 'cua-driver', 'package.json'), 'utf8'),
).version;
const stagedDriver = readFileSync(driverStamp, 'utf8').trim();
if (stagedDriver !== sdkVersion) {
  fail(
    `cua-driver ${stagedDriver} is staged but the SDK is ${sdkVersion}.\n` +
      `        Every computer-use call would refuse on a version mismatch.\n` +
      `        Re-run \`node scripts/fetch-cua-driver.mjs\`.`,
  );
}
console.log(`[electron-builder] cua-driver ${stagedDriver} staged for ${driverTarget}`);

// ── Configuration ────────────────────────────────────────────────
const version = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')).version;
const channel = process.env['GENERATORAI_RELEASE_CHANNEL'] ?? resolveChannel(version);

let signing;
try {
  signing = resolveSigning({ platform, env });
} catch (err) {
  if (err instanceof PartialSigningConfigError) fail(err.message);
  throw err;
}
console.log(`[electron-builder] ${signing.reason}`);

// An unsigned build may be packaged (local testing, CI artifacts) but not
// PUBLISHED without an explicit ALLOW_UNSIGNED_RELEASE=1 — see build-config.
try {
  assertPublishAllowed({ argv, signed: signing.signed, platform, env });
} catch (err) {
  if (err instanceof UnsignedPublishError) fail(err.message);
  throw err;
}
if (!signing.signed && env.ALLOW_UNSIGNED_RELEASE === '1') {
  console.warn('[electron-builder] ALLOW_UNSIGNED_RELEASE=1 — publishing an unsigned build on request.');
}

const config = createBuildConfig({
  platform,
  arch: stage.arch,
  channel,
  signed: signing.signed,
  env,
  // Repoints the build at scripts/mock-update-server.mjs so the auto-update
  // path can be exercised before a real release depends on it.
  publish: env['GENERATORAI_UPDATE_URL']
    ? { provider: 'generic', url: env['GENERATORAI_UPDATE_URL'], channel }
    : undefined,
});

const target = config.publish?.[0];
console.log(
  `[electron-builder] update feed: ${
    target
      ? target.provider === 'github'
        ? `github ${target.owner}/${target.repo} (${target.releaseType})`
        : `${target.provider} ${target.url}`
      : 'none — set GITHUB_REPOSITORY or GENERATORAI_UPDATE_URL to publish one'
  }`,
);

// Written inside the project directory so that every relative path in the
// config keeps resolving the way it did when this lived in package.json.
const configPath = path.join(desktopRoot, '.electron-builder.generated.json');
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

if (!signing.signed) env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

// Go through the declared bin rather than an `out/` path, which is internal
// and has moved between major versions.
const manifestPath = require.resolve('electron-builder/package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const cli = path.resolve(path.dirname(manifestPath), manifest.bin['electron-builder']);

console.log(
  `[electron-builder] ${platform}/${stage.arch} on the '${channel}' channel` +
    `${signing.signed ? ' (signed)' : ' (unsigned)'}`,
);

// ── Start from an empty output directory ─────────────────────────
//
// Artifact names carry the version, so a rebuild at a different version adds
// files rather than replacing them, and `release/` accumulates every build the
// machine has ever done. That is not just untidy:
//
//   - `verify:release` re-hashes whatever manifests it finds against whatever
//     artifacts it finds. With a stale `alpha.yml` from a previous version
//     sitting beside its equally stale installer, it passes — having verified
//     nothing at all about the build that just ran. Observed exactly that: a
//     manifest five weeks old was "consistent with its artifacts" while the
//     installers built moments earlier went unchecked.
//   - The release workflow uploads `release/*.exe`, `*.dmg` and friends by
//     glob. A dirty directory would attach two versions to one release.
//
// CI never sees it — a fresh checkout has nothing to accumulate — which is
// exactly why it survives locally, where the confusion actually happens.
// Only the DISTRIBUTABLES and the manifests. `win-unpacked` (and its siblings)
// are staging directories electron-builder overwrites in place, and on Windows
// they are exactly what still holds a lock after the app has been run from
// them — removing the whole directory failed with EPERM for that reason. The
// files that go stale are the ones whose names carry a version, so those are
// the ones to remove.
//
// Best-effort on purpose. A clean that cannot finish must not fail a build:
// the actual guarantee lives in `verify:release`, which asserts the manifest
// describes THIS version, so a leftover cannot quietly pass as current even if
// it survives. This step keeps the directory honest; the verifier is what makes
// it safe.
const releaseOutputDir = path.join(desktopRoot, 'release');
const STALE = /\.(exe|dmg|zip|AppImage|deb|rpm|blockmap|yml)$/;
if (existsSync(releaseOutputDir)) {
  let removed = 0;
  let kept = 0;
  for (const entry of readdirSync(releaseOutputDir, { withFileTypes: true })) {
    if (!entry.isFile() || !STALE.test(entry.name)) continue;
    try {
      rmSync(path.join(releaseOutputDir, entry.name), { maxRetries: 5, retryDelay: 200 });
      removed += 1;
    } catch {
      kept += 1;
    }
  }
  if (removed || kept) {
    console.log(
      `[electron-builder] cleared ${removed} previous artifact(s) from release/` +
        `${kept ? ` (${kept} locked, left in place — verify:release will reject any that are stale)` : ''}.`,
    );
  }
}

const { status } = spawnSync(
  process.execPath,
  [cli, '--config', configPath, ...argv],
  { stdio: 'inherit', env, cwd: desktopRoot },
);

rmSync(configPath, { force: true });

if (status !== 0) process.exit(status ?? 1);

// ── Withdraw manifests that cannot be honoured ───────────────────
const releaseDir = path.join(desktopRoot, 'release');
for (const name of unpublishableManifests({ platform, signed: signing.signed, channel })) {
  const manifestFile = path.join(releaseDir, name);
  if (existsSync(manifestFile)) {
    rmSync(manifestFile);
    console.warn(
      `[electron-builder] removed ${name}: an unsigned macOS build cannot self-update ` +
        `(Squirrel.Mac rejects unverifiable signatures), so publishing it would advertise ` +
        `an update path that fails on every client.`,
    );
  }
}

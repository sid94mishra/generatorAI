// ────────────────────────────────────────────────────────────────
// Fetches the cua-driver executable for one target and stages it under
// apps/desktop/resources/cua-driver/<platform>-<arch>/.
//
// Build time, never install or first run. An install-time download breaks
// offline and proxied installs and puts a network fetch inside an elevated
// installer; a first-run download means an unsigned executable appears on disk
// AFTER our signature was verified.
//
// The version is not a preference. The SDK verifies contract, tool-schema and
// capability versions against the daemon and refuses before dispatch, so a
// driver that disagrees with the installed npm package makes every
// computer-use call fail — silently, and everywhere at once. The version is
// therefore read from the installed package, not passed in.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function fail(message) {
  console.error(`[cua-driver] ${message}`);
  process.exit(1);
}

/** Release asset naming, which does not match the npm platform triple. */
const ASSET = {
  'win32-x64': { file: (v) => `cua-driver-rs-${v}-windows-x86_64.zip`, exe: 'cua-driver.exe' },
  'win32-arm64': { file: (v) => `cua-driver-rs-${v}-windows-arm64.zip`, exe: 'cua-driver.exe' },
  'darwin-x64': { file: (v) => `cua-driver-rs-${v}-darwin-universal.tar.gz`, exe: 'cua-driver' },
  'darwin-arm64': { file: (v) => `cua-driver-rs-${v}-darwin-universal.tar.gz`, exe: 'cua-driver' },
  'linux-x64': { file: (v) => `cua-driver-rs-${v}-linux-x86_64.tar.gz`, exe: 'cua-driver' },
  'linux-arm64': { file: (v) => `cua-driver-rs-${v}-linux-arm64.tar.gz`, exe: 'cua-driver' },
};

const platform = process.env['GENERATORAI_STAGE_PLATFORM'] ?? process.platform;
const arch = process.env['GENERATORAI_STAGE_ARCH'] ?? process.arch;
const target = `${platform}-${arch}`;
const asset = ASSET[target];
if (!asset) fail(`no published cua-driver build for ${target}`);

// Read straight off disk: the package is ESM-only with no `require` condition
// and does not export its own manifest, so neither resolver form works.
const driverPkg = path.join(repoRoot, 'node_modules', '@trycua', 'cua-driver', 'package.json');
if (!fs.existsSync(driverPkg)) fail('@trycua/cua-driver is not installed; run pnpm install first.');
const version = JSON.parse(fs.readFileSync(driverPkg, 'utf8')).version;

const outDir = path.join(repoRoot, 'apps', 'desktop', 'resources', 'cua-driver', target);
const outExe = path.join(outDir, asset.exe);
const stamp = path.join(outDir, '.version');

if (fs.existsSync(outExe) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === version) {
  console.log(`[cua-driver] ${target} already staged at ${version}`);
  process.exit(0);
}

const tag = `cua-driver-rs-v${version}`;
const base = `https://github.com/trycua/cua/releases/download/${tag}`;
const assetName = asset.file(version);

console.log(`[cua-driver] fetching ${assetName} (${tag}) for ${target}`);

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) fail(`${url} → HTTP ${res.status}. Is ${tag} published?`);
  return Buffer.from(await res.arrayBuffer());
}

// Checksums first: an archive that arrives before its manifest cannot be
// checked against anything, and "verify later" reliably becomes "never".
const checksums = (await download(`${base}/checksums.txt`)).toString('utf8');
const expected = checksums
  .split('\n')
  .map((line) => line.trim().split(/\s+/))
  .find(([, name]) => name === assetName)?.[0];
if (!expected) fail(`${assetName} is not listed in ${tag}'s checksums.txt`);

const archive = await download(`${base}/${assetName}`);
const actual = createHash('sha256').update(archive).digest('hex');
if (actual !== expected) {
  fail(`checksum mismatch for ${assetName}\n        expected ${expected}\n        got      ${actual}`);
}
console.log(`[cua-driver] sha256 verified`);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const archivePath = path.join(outDir, assetName);
fs.writeFileSync(archivePath, archive);

// tar is present on every supported host (Windows 10 1803+ ships bsdtar), and
// shelling out avoids adding an archive dependency to the build.
if (assetName.endsWith('.zip')) {
  execFileSync('tar', ['-xf', archivePath, '-C', outDir], { stdio: 'inherit' });
} else {
  execFileSync('tar', ['-xzf', archivePath, '-C', outDir], { stdio: 'inherit' });
}
fs.rmSync(archivePath, { force: true });

// Release archives nest everything under one directory. Flatten the whole
// payload, not just the entry point: cua-driver.exe spawns `cua-driver-uia`
// (the out-of-process UIA worker) and `cua-cursor-theme`, so shipping the
// entry point alone produces a driver that starts and then cannot read a
// window.
const entries = fs.readdirSync(outDir, { withFileTypes: true });
const nested = entries.filter((e) => e.isDirectory());
for (const dir of nested) {
  const from = path.join(outDir, dir.name);
  for (const file of fs.readdirSync(from)) {
    fs.renameSync(path.join(from, file), path.join(outDir, file));
  }
  fs.rmSync(from, { recursive: true, force: true });
}

if (!fs.existsSync(outExe)) fail(`${asset.exe} was not found in ${assetName}`);

if (platform !== 'win32') {
  for (const file of fs.readdirSync(outDir)) {
    if (!file.includes('.') || file.endsWith('.exe')) fs.chmodSync(path.join(outDir, file), 0o755);
  }
}
fs.writeFileSync(stamp, `${version}\n`);

const total = fs
  .readdirSync(outDir)
  .reduce((sum, f) => sum + fs.statSync(path.join(outDir, f)).size, 0);
console.log(
  `[cua-driver] staged ${fs.readdirSync(outDir).length} files into ` +
    `${path.relative(repoRoot, outDir)} (${(total / 1024 / 1024).toFixed(1)} MB, v${version})`,
);

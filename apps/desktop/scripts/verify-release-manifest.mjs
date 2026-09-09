// ────────────────────────────────────────────────────────────────
// Checks that the update manifest agrees with the files next to it.
//
// electron-updater downloads whatever `<channel>.yml` names, then verifies the
// sha512 it recorded. If the two disagree the update fails on every client at
// once, and nothing before this point notices: electron-builder writes the
// manifest when it finishes a target, so a later target writing to the same
// filename silently invalidates it. That is not hypothetical — a `portable`
// target sharing the NSIS `artifactName` did exactly this.
//
// Runs against the release directory after packaging, before anything uploads.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { resolveSigning } from './lib/build-config.mjs';

const releaseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'release');

if (!fs.existsSync(releaseDir)) {
  console.error(`[verify] ${releaseDir} does not exist — package the app first.`);
  process.exit(1);
}

// `builder-debug.yml` is diagnostics, not an update manifest.
const manifests = fs
  .readdirSync(releaseDir)
  .filter((name) => name.endsWith('.yml') && name !== 'builder-debug.yml');

if (manifests.length === 0) {
  // ── The one case where zero manifests is CORRECT ──────────────
  //
  // An unsigned macOS build cannot self-update: Squirrel.Mac refuses a
  // signature it cannot verify. `electron-builder.mjs` therefore DELETES
  // `<channel>-mac.yml` after packaging, deliberately, rather than advertise an
  // update path that fails on every client.
  //
  // On macOS that is the only manifest produced — so this check, which runs
  // straight afterwards, found nothing and exited 1. The Mac leg of the release
  // failed, and because the publish job waits on the whole desktop matrix, the
  // release produced NOTHING AT ALL. Two correct behaviours cancelling each
  // other out; neither file was wrong on its own.
  //
  // The same signing logic that decides to remove the manifest decides here
  // whether its absence is expected, so the two cannot drift apart.
  const isMac = process.platform === 'darwin';
  const { signed } = resolveSigning({ platform: 'mac', env: process.env });

  if (isMac && !signed) {
    const installers = fs
      .readdirSync(releaseDir)
      .filter((name) => name.endsWith('.dmg') || name.endsWith('.zip'));

    if (installers.length === 0) {
      console.error('[verify] no manifest AND no installer — the macOS build produced nothing.');
      process.exit(1);
    }

    console.warn(
      `[verify] no update manifest, which is correct here: this is an UNSIGNED macOS build, ` +
        `so the manifest was withheld on purpose. ${installers.length} installer(s) verified as ` +
        `present. Mac users download each new version by hand until the build is signed and ` +
        `notarised.`,
    );
    process.exit(0);
  }

  console.error('[verify] no update manifest found — electron-updater would have nothing to read.');
  process.exit(1);
}

const problems = [];

for (const manifestName of manifests) {
  const manifest = parse(fs.readFileSync(path.join(releaseDir, manifestName), 'utf8'));

  for (const entry of manifest.files ?? []) {
    const filePath = path.join(releaseDir, entry.url);

    if (!fs.existsSync(filePath)) {
      problems.push(`${manifestName} → ${entry.url}: referenced but not present`);
      continue;
    }

    const contents = fs.readFileSync(filePath);
    const sha512 = crypto.createHash('sha512').update(contents).digest('base64');

    if (contents.length !== entry.size) {
      problems.push(
        `${manifestName} → ${entry.url}: size is ${contents.length}, manifest says ${entry.size}`,
      );
    } else if (sha512 !== entry.sha512) {
      problems.push(`${manifestName} → ${entry.url}: sha512 does not match the manifest`);
    } else {
      console.log(`[verify] ${manifestName} → ${entry.url} ✓`);
    }
  }
}

if (problems.length > 0) {
  console.error(
    `\n[verify] ${problems.length} manifest inconsistencies — updates would fail for these:\n` +
      problems.map((problem) => `  • ${problem}`).join('\n'),
  );
  process.exit(1);
}

console.log(`[verify] ${manifests.length} manifest(s) consistent with their artifacts.`);

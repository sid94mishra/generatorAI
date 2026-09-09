#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Stamp one release version onto every manifest that ships.
//
// GeneratorAI is one product split across devices, not a collection of
// independent libraries, so "which version am I running" has to have a single
// answer across the desktop app, the command-line tool and the phone app.
// Before this script there were five different numbers — the root said
// 0.0.1-alpha.1, the CLI said 0.2.0, the phone said 0.1.0 — and the release
// tag only ever moved the desktop one.
//
// The numbers in the working tree are placeholders. This runs in CI, from the
// tag or the manually entered version, and nothing is committed: the manifests
// on the branch stay at whatever they say, and the release is the only place a
// real version exists.
//
// The phone app is not listed here on purpose. Its version lives in
// `app.config.ts`, which is TypeScript rather than JSON, so it reads
// `GENERATORAI_VERSION` from the environment instead of being rewritten — see
// the comment there. Its *build number* is separate again and must only ever
// increase, which the store tooling handles on its own.
//
//   node scripts/stamp-version.mjs 0.1.0-alpha.1
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every manifest whose `version` a user can end up reading. */
const MANIFESTS = [
  'package.json',
  'apps/desktop/package.json',
  'apps/cli/package.json',
];

const raw = process.argv[2];
if (!raw) {
  console.error('usage: node scripts/stamp-version.mjs <version>   (e.g. 0.1.0-alpha.1)');
  process.exit(1);
}

// Accept `v0.1.0` as well as `0.1.0` — the tag route naturally carries the v.
const version = raw.replace(/^v/, '');

// Same shape the release workflow enforces. Checking it here too means a local
// run cannot quietly write something electron-builder will reject much later.
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`'${raw}' is not a valid version (expected MAJOR.MINOR.PATCH[-prerelease]).`);
  process.exit(1);
}

let changed = 0;
for (const relative of MANIFESTS) {
  const file = path.join(repoRoot, relative);
  if (!fs.existsSync(file)) {
    console.error(`::error::${relative} does not exist — the manifest list is out of date.`);
    process.exit(1);
  }

  const before = fs.readFileSync(file, 'utf8');

  // A targeted replacement of the top-level `version` field rather than
  // parse-and-restringify: rewriting the whole file would reformat it and turn
  // a one-line change into an unreviewable diff whenever this is run locally.
  const after = before.replace(/^(\s*"version"\s*:\s*)"[^"]*"/m, `$1"${version}"`);

  if (after === before) {
    console.error(`::error::could not find a top-level "version" field in ${relative}.`);
    process.exit(1);
  }

  fs.writeFileSync(file, after);
  console.log(`  ${relative} → ${version}`);
  changed += 1;
}

console.log(`Stamped ${version} onto ${changed} manifest(s).`);
console.log('The phone app reads GENERATORAI_VERSION from the environment instead.');

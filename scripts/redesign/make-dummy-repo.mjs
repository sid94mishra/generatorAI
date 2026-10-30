#!/usr/bin/env node
// Creates a throwaway git repo for testing source-control features
// (09-verification.md §6.6). Never point the app's SCM features at this checkout.
//
//   node scripts/redesign/make-dummy-repo.mjs          → prints the work/ path
//   node scripts/redesign/make-dummy-repo.mjs --clean  → removes every generatorai-dummy-repo-*
//
// Layout under <os.tmpdir()>/generatorai-dummy-repo-<stamp>/:
//   origin.git  bare remote
//   work/       clone: main with 3 commits (README.md, src/app.ts, src/util.ts,
//               assets/logo.png binary, data/big.json over the diff "too large" limit);
//               feature/redesign-test 2 commits ahead (pushed); conflict-a / conflict-b
//               editing the same line; a working tree with one modified, one added,
//               one deleted, one renamed and one untracked file.
// The prefix is `generatorai-`, not `gai-`/`genai-`, which sweep-temp-workspaces deletes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PREFIX = 'generatorai-dummy-repo-';
// packages/changes/src/summaryTypes.ts MAX_FILE_BODY_BYTES is 512 KiB; stay well above it.
const BIG_JSON_BYTES = 700 * 1024;

if (process.argv.includes('--clean')) {
  const tmp = os.tmpdir();
  let removed = 0;
  for (const name of fs.readdirSync(tmp)) {
    if (!name.startsWith(PREFIX)) continue;
    fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    removed += 1;
  }
  console.log(`removed ${removed} dummy repo(s) from ${tmp}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const root = fs.mkdtempSync(path.join(os.tmpdir(), `${PREFIX}${stamp}-`));
const origin = path.join(root, 'origin.git');
const work = path.join(root, 'work');

// Deterministic identity and no user/system config, so the repo looks the same on every machine.
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'),
  GIT_AUTHOR_NAME: 'Dummy Author',
  GIT_AUTHOR_EMAIL: 'dummy@example.invalid',
  GIT_COMMITTER_NAME: 'Dummy Author',
  GIT_COMMITTER_EMAIL: 'dummy@example.invalid',
};
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const write = (rel, content) => {
  const file = path.join(work, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const commit = (message) => {
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', message);
};

// A valid 1×1 PNG, so the file is real binary content.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function bigJson() {
  const items = [];
  let size = 2;
  for (let i = 0; size < BIG_JSON_BYTES; i += 1) {
    const item = JSON.stringify({ id: i, name: `item-${i}`, tags: ['alpha', 'beta', 'gamma'], value: i * 31 });
    items.push(item);
    size += item.length + 2;
  }
  return `[\n${items.join(',\n')}\n]\n`;
}

git(root, 'init', '-q', '--bare', origin);
git(root, 'clone', '-q', origin, work);
git(work, 'checkout', '-q', '-b', 'main');

// main: 3 commits
write('README.md', '# Dummy repo\n\nThrowaway repository for GeneratorAI source-control testing.\n');
write('src/app.ts', "import { greet } from './util';\n\nexport function main(): string {\n  return greet('world');\n}\n");
write('src/util.ts', 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n');
commit('Initial commit');
write('assets/logo.png', PNG_1X1);
write('data/big.json', bigJson());
commit('Add logo and data fixture');
write('src/util.ts', 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nexport const VERSION = 1;\n');
write('src/legacy.ts', 'export const LEGACY = true;\n');
write('src/old-name.ts', 'export const RENAMED = false;\n');
commit('Add version constant');
git(work, 'push', '-q', '-u', 'origin', 'main');

// feature/redesign-test: 2 commits ahead of main, pushed
git(work, 'checkout', '-q', '-b', 'feature/redesign-test');
write('src/feature.ts', "export const feature = 'redesign';\n");
commit('Add feature flag');
write('README.md', '# Dummy repo\n\nThrowaway repository for GeneratorAI source-control testing.\n\n## Feature\nRedesign test branch.\n');
commit('Document the feature');
git(work, 'push', '-q', '-u', 'origin', 'feature/redesign-test');

// conflict-a / conflict-b: both edit line 1 of README.md
for (const [branch, line] of [
  ['conflict-a', '# Dummy repo (version A)'],
  ['conflict-b', '# Dummy repo (version B)'],
]) {
  git(work, 'checkout', '-q', 'main');
  git(work, 'checkout', '-q', '-b', branch);
  const readme = fs.readFileSync(path.join(work, 'README.md'), 'utf8').split('\n');
  readme[0] = line;
  write('README.md', readme.join('\n'));
  commit(`Edit title on ${branch}`);
  git(work, 'push', '-q', '-u', 'origin', branch);
}

// Working tree on main: modified, added, deleted, renamed, untracked
git(work, 'checkout', '-q', 'main');
write('src/app.ts', "import { greet } from './util';\n\nexport function main(): string {\n  return greet('GeneratorAI');\n}\n");
write('src/added.ts', 'export const ADDED = true;\n');
git(work, 'add', 'src/added.ts');
git(work, 'rm', '-q', 'src/legacy.ts');
git(work, 'mv', 'src/old-name.ts', 'src/new-name.ts');
write('notes/untracked.md', 'This file is untracked.\n');

console.log(work);

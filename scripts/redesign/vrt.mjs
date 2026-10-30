#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// `pnpm vrt` — visual regression in the pinned Linux container
// (docs/redesign/09-verification.md §4.4, §4.5; D-34).
//
//   pnpm vrt                           every project (P1: stories)
//   pnpm vrt --project stories         one project
//   pnpm vrt --grep foundations        a subset (Playwright --grep)
//   pnpm vrt --update                  rewrite changed baselines (--update-snapshots=changed)
//   pnpm vrt --update-missing          write only baselines that do not exist yet (CI bootstrap)
//   pnpm vrt --repeat-each 10 --grep … flake hunt
//   pnpm vrt --no-build                reuse the last built image
//
// What it does:
//   1. Refuses unless the Docker CLI answers and docker/vrt.Dockerfile's
//      playwright image tag equals agent-tests' @playwright/test version.
//   2. docker build -f docker/vrt.Dockerfile -t generatorai/vrt .
//   3. docker run with ONLY the baselines and test-results bind-mounted:
//      host node_modules never enter the container (macOS/Windows native
//      binaries do not run on Linux).
// Node, not bash, so it runs the same on Windows, Linux and macOS.
// ────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCKERFILE = path.join('docker', 'vrt.Dockerfile');
const IMAGE = 'generatorai/vrt';
const CONTAINER_REPO = '/repo';
const SCREENSHOTS = path.join('agent-tests', 'vrt', '__screenshots__');
const RESULTS = path.join('agent-tests', 'test-results');

function fail(message) {
  console.error(`[vrt] ${message}`);
  process.exit(1);
}

/** The `FROM mcr.microsoft.com/playwright:vX.Y.Z-…` version in the Dockerfile. */
export function dockerPlaywrightVersion(dockerfile) {
  const m = /^FROM\s+mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)\b/m.exec(dockerfile);
  return m ? m[1] : null;
}

/** The @playwright/test version agent-tests resolved (installed copy, else the lockfile). */
function installedPlaywrightVersion() {
  const installed = path.join(ROOT, 'agent-tests', 'node_modules', '@playwright', 'test', 'package.json');
  if (fs.existsSync(installed)) return JSON.parse(fs.readFileSync(installed, 'utf8')).version;
  const lock = fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  const block = lock.split(/\n {2}agent-tests:\n/)[1] ?? '';
  const m = /'@playwright\/test':\s*\n\s+specifier:[^\n]*\n\s+version:\s*(\d+\.\d+\.\d+)/.exec(block);
  return m ? m[1] : null;
}

/** CLI flags → Playwright arguments. Exported for the rails tests. */
export function playwrightArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-build') continue;
    if (arg === '--update') out.push('--update-snapshots=changed');
    else if (arg === '--update-missing') out.push('--update-snapshots=missing');
    else out.push(arg);
  }
  return out;
}

function docker(args, options = {}) {
  const r = spawnSync('docker', args, { cwd: ROOT, stdio: 'inherit', ...options });
  if (r.error) fail(`could not run docker: ${r.error.message}`);
  return r.status ?? 1;
}

function main() {
  const argv = process.argv.slice(2);

  const probe = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { cwd: ROOT, encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    fail(
      'Docker is not available (the CLI is missing or the daemon is not running). VRT baselines are only ever ' +
        'rendered in the pinned Linux container; install Docker (Desktop, Engine, OrbStack or Colima) or let the CI `vrt` job run it.',
    );
  }

  const want = dockerPlaywrightVersion(fs.readFileSync(path.join(ROOT, DOCKERFILE), 'utf8'));
  const have = installedPlaywrightVersion();
  if (!want || !have || want !== have) {
    fail(`${DOCKERFILE} pins playwright v${want ?? '?'} but agent-tests has @playwright/test ${have ?? '?'}; make them equal.`);
  }

  if (!argv.includes('--no-build')) {
    const status = docker(['build', '-f', DOCKERFILE, '-t', IMAGE, '.']);
    if (status !== 0) process.exit(status);
  }

  for (const dir of [SCREENSHOTS, RESULTS]) fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
  const mount = (rel) => [
    '--mount',
    `type=bind,source=${path.join(ROOT, rel)},target=${CONTAINER_REPO}/${rel.split(path.sep).join('/')}`,
  ];
  // Files written into the bind mounts should belong to the caller, not root.
  // process.getuid exists only on POSIX hosts; Docker Desktop on Windows maps ownership itself.
  const user = typeof process.getuid === 'function' ? ['--user', `${process.getuid()}:${process.getgid()}`, '-e', 'HOME=/tmp'] : [];

  const status = docker([
    'run',
    '--rm',
    '--ipc=host',
    ...user,
    ...mount(SCREENSHOTS),
    ...mount(RESULTS),
    IMAGE,
    'pnpm',
    '--filter',
    '@generatorai/agent-tests',
    'exec',
    'playwright',
    'test',
    '-c',
    'vrt/playwright.vrt.config.ts',
    ...playwrightArgs(argv),
  ]);
  process.exit(status);
}

// realpath: through a symlink or macOS /tmp → /private/tmp, argv[1] differs from import.meta.url.
function isMain() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main();

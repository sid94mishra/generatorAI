#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Release rehearsal — run the release workflow's steps on this machine.
//
// The release builds five things and publishes them once. Finding out whether
// any of that works by pushing a tag is an expensive way to learn: a failure
// there is public, and half the pipeline has already spent its time. This runs
// the same commands locally, in the same order, and stops at the point where
// publishing would begin.
//
// What it CANNOT do is as important as what it can:
//
//   macOS installer   — electron-builder refuses to build for macOS anywhere
//                       but macOS. No flag, container or VM changes that.
//   Android APK       — needs the Android SDK and JDK 17. Detected, not faked.
//   Publishing        — needs GitHub, a registry and npm. Deliberately absent:
//                       a rehearsal that could publish is not a rehearsal.
//
// Everything else is real. The installer this produces is the file a user
// downloads, built the way CI builds it.
//
//   node scripts/rehearse-release.mjs                    everything available
//   node scripts/rehearse-release.mjs --only=cli,desktop  a subset
//   node scripts/rehearse-release.mjs --version 0.2.0     a specific version
//   node scripts/rehearse-release.mjs --list              what would run, and why
//
// The version is stamped onto the real manifests, exactly as CI does it, and
// restored from git when the run ends — including on failure or Ctrl-C.
// ────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`) || a === `--${name}`);
  if (!hit) return fallback;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  return argv[argv.indexOf(hit) + 1] ?? fallback;
};

const VERSION = arg('version', '0.0.0-rehearsal.1');
const ONLY = arg('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LIST_ONLY = argv.includes('--list');

/** Manifests `stamp-version.mjs` writes, so we can put them back. */
const STAMPED = ['package.json', 'apps/desktop/package.json', 'apps/cli/package.json'];

const results = [];
let stamped = false;

function run(command, args, { cwd = repoRoot, env = {}, allowFailure = false } = {}) {
  const shown = `${command} ${args.join(' ')}`;
  process.stdout.write(`\n  $ ${shown}\n`);
  const r = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0 && !allowFailure) {
    throw new Error(`exited ${r.status ?? 'signal ' + r.signal}: ${shown}`);
  }
  return r.status === 0;
}

function capture(command, args, cwd = repoRoot) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Total bytes of a directory tree, for reporting what a user would download. */
function sizeOf(target) {
  const info = statSync(target);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    total += sizeOf(path.join(target, entry.name));
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

function restoreManifests() {
  if (!stamped) return;
  spawnSync('git', ['checkout', '--', ...STAMPED], { cwd: repoRoot, stdio: 'ignore' });
  stamped = false;
  console.log('\n[rehearsal] version stamps restored from git.');
}

// A rehearsal that leaves the tree stamped is a rehearsal that ends in a
// confusing diff, or worse, a commit of a fake version.
process.on('exit', restoreManifests);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restoreManifests();
    process.exit(130);
  });
}

// ── What can run here ────────────────────────────────────────────

const HOST = process.platform;

function dockerReady() {
  return spawnSync('docker', ['info'], { stdio: 'ignore', shell: HOST === 'win32' }).status === 0;
}

function androidReady() {
  const sdk = process.env['ANDROID_HOME'] ?? process.env['ANDROID_SDK_ROOT'];
  if (!sdk || !existsSync(sdk)) return { ok: false, why: 'no Android SDK (ANDROID_HOME unset)' };
  const version = capture('java', ['-version']) ?? '';
  const major = /version "(\d+)/.exec(version)?.[1];
  if (major && Number(major) !== 17) {
    return { ok: false, why: `JDK ${major} found; React Native 0.86 builds against JDK 17` };
  }
  return { ok: true, why: '' };
}

const STEPS = [
  {
    id: 'preflight',
    title: 'Preflight — the gates a release must pass',
    can: () => ({ ok: true, why: '' }),
    run() {
      run('pnpm', ['turbo', 'build']);
      // `pnpm lint`, not `turbo lint`: the root script adds five gates the
      // task runner alone skips. This is the whole point of the step.
      run('pnpm', ['lint']);
      run('pnpm', ['turbo', 'typecheck']);
      run('pnpm', ['turbo', 'test']);
      return 'build, lint (6 gates), typecheck, test';
    },
  },
  {
    id: 'cli',
    title: 'Command-line tool — bundle, pack, install into a clean directory, run',
    can: () => ({ ok: true, why: '' }),
    run() {
      run('pnpm', ['turbo', 'build', '--filter=@generatorai/cli...']);
      run('pnpm', ['--filter', '@generatorai/cli', 'run', 'bundle']);

      const dest = mkdtempSync(path.join(tmpdir(), 'gai-rehearse-cli-'));
      try {
        run('pnpm', ['--filter', '@generatorai/cli', 'pack', '--pack-destination', dest]);
        const tgz = readdirSync(dest).find((f) => f.endsWith('.tgz'));
        if (!tgz) throw new Error('pack produced no tarball');
        const tarball = path.join(dest, tgz);

        // Exactly what `npm i -g` consumes — no workspace symlinks in sight.
        const home = path.join(dest, 'install');
        run('npm', ['init', '-y'], { cwd: mkdirp(home) });
        run('npm', ['install', '--ignore-scripts', tarball], { cwd: home });

        const bin = path.join(home, 'node_modules/@generatorai/cli/dist-bundle/generatorai.mjs');
        if (!existsSync(bin)) throw new Error('packed tarball is missing its bin');
        run('node', [bin, '--version']);

        return `${mb(sizeOf(tarball))} tarball, installs and runs`;
      } finally {
        rmSync(dest, { recursive: true, force: true });
      }
    },
  },
  {
    id: 'desktop',
    title: `Desktop installer for ${HOST === 'win32' ? 'Windows' : HOST === 'darwin' ? 'macOS' : 'Linux'}`,
    can: () => ({ ok: true, why: '' }),
    run() {
      const arch = HOST === 'darwin' ? 'arm64' : 'x64';
      const env = { GENERATORAI_STAGE_ARCH: arch, GENERATORAI_RELEASE_CHANNEL: 'alpha' };

      run('pnpm', ['--filter', '@generatorai/desktop', 'prepack:dist'], { env });
      run('pnpm', ['run', 'electron-builder', `--${arch}`, '--publish', 'never'], {
        cwd: path.join(repoRoot, 'apps/desktop'),
        env,
      });
      // The check that matters: electron-updater trusts the manifest utterly.
      run('pnpm', ['run', 'verify:release'], { cwd: path.join(repoRoot, 'apps/desktop') });

      const releaseDir = path.join(repoRoot, 'apps/desktop/release');
      const installers = readdirSync(releaseDir).filter((f) =>
        /\.(exe|dmg|AppImage|deb|rpm)$/.test(f),
      );
      for (const f of installers) {
        console.log(`      ${f} — ${mb(sizeOf(path.join(releaseDir, f)))}`);
      }
      return `${installers.length} installer(s) in apps/desktop/release`;
    },
  },
  {
    id: 'container',
    title: 'Server container — build, boot, wait for its health endpoint',
    can: () =>
      dockerReady()
        ? { ok: true, why: '' }
        : { ok: false, why: 'Docker daemon not reachable — start Docker Desktop' },
    run() {
      const tag = 'generatorai/server:rehearsal';
      run('docker', ['build', '-f', 'docker/server.Dockerfile', '-t', tag, '.']);

      const name = 'gai-rehearsal';
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', shell: HOST === 'win32' });

      const key = capture('node', [
        '-e',
        "console.log(require('crypto').randomBytes(32).toString('hex'))",
      ]);
      run('docker', [
        'run', '-d', '--name', name, '-p', '3199:3100',
        '-e', `GENERATORAI_SECRET_KEY=${key}`,
        tag,
      ]);

      try {
        const deadline = Date.now() + 180_000;
        for (;;) {
          const alive = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', name], {
            encoding: 'utf8',
            shell: HOST === 'win32',
          }).stdout?.trim();
          if (alive !== 'true') {
            run('docker', ['logs', '--tail', '40', name], { allowFailure: true });
            throw new Error('the container exited before becoming healthy');
          }

          const probe = spawnSync(
            'node',
            ['-e', "fetch('http://127.0.0.1:3199/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
            { shell: HOST === 'win32' },
          );
          if (probe.status === 0) break;

          if (Date.now() > deadline) {
            run('docker', ['logs', '--tail', '40', name], { allowFailure: true });
            throw new Error('container did not become healthy within 180s');
          }
          spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)']);
        }
        const size = capture('docker', ['image', 'inspect', tag, '--format', '{{.Size}}']);
        return `image healthy on :3199${size ? ` — ${mb(Number(size))}` : ''}`;
      } finally {
        spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', shell: HOST === 'win32' });
      }
    },
  },
  {
    id: 'android',
    title: 'Android app — bundle hygiene, prebuild, APK',
    can: androidReady,
    run() {
      run('pnpm', ['turbo', 'build', '--filter=@generatorai/mobile^...']);
      run('pnpm', ['run', 'bundle:check'], { cwd: path.join(repoRoot, 'apps/mobile') });
      run('pnpm', ['exec', 'expo', 'prebuild', '--platform', 'android', '--no-install'], {
        cwd: path.join(repoRoot, 'apps/mobile'),
        env: { GENERATORAI_VERSION: VERSION },
      });
      const gradlew = HOST === 'win32' ? 'gradlew.bat' : './gradlew';
      run(gradlew, ['assembleRelease', '--no-daemon'], {
        cwd: path.join(repoRoot, 'apps/mobile/android'),
        env: { GENERATORAI_VERSION: VERSION },
      });
      return 'APK built';
    },
  },
];

function mkdirp(dir) {
  spawnSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(dir)},{recursive:true})`]);
  return dir;
}

// ── Run ──────────────────────────────────────────────────────────

const selected = STEPS.filter((s) => ONLY.length === 0 || ONLY.includes(s.id));

console.log('\n╭─ Release rehearsal');
console.log(`│  version   ${VERSION}`);
console.log(`│  host      ${HOST}`);
console.log(`│  steps     ${selected.map((s) => s.id).join(', ') || '(none selected)'}`);
console.log('╰─\n');

if (LIST_ONLY) {
  for (const step of STEPS) {
    const { ok, why } = step.can();
    console.log(`  ${ok ? '✓' : '·'} ${step.id.padEnd(10)} ${ok ? 'available' : `unavailable — ${why}`}`);
  }
  console.log(`\n  Never available here: macOS installer (needs a Mac), publishing (by design).\n`);
  process.exit(0);
}

let failed = false;

for (const step of selected) {
  const { ok, why } = step.can();
  if (!ok) {
    console.log(`\n── ${step.title}\n   SKIPPED — ${why}`);
    results.push({ id: step.id, state: 'skipped', detail: why });
    continue;
  }

  console.log(`\n── ${step.title}`);
  if (!stamped && step.id !== 'preflight') {
    run('node', ['scripts/stamp-version.mjs', VERSION]);
    stamped = true;
  }

  const started = Date.now();
  try {
    const detail = step.run();
    const secs = Math.round((Date.now() - started) / 1000);
    results.push({ id: step.id, state: 'ok', detail: `${detail} (${secs}s)` });
  } catch (err) {
    failed = true;
    results.push({ id: step.id, state: 'FAILED', detail: err.message });
    console.error(`\n   FAILED: ${err.message}`);
  }
}

console.log('\n╭─ Rehearsal summary');
for (const r of results) {
  const mark = r.state === 'ok' ? '✓' : r.state === 'skipped' ? '·' : '✗';
  console.log(`│  ${mark} ${r.id.padEnd(10)} ${r.detail}`);
}
console.log('╰─');

console.log(
  '\n  Not covered by any local rehearsal: the macOS installer (needs a Mac) and\n' +
    '  every publishing step (GitHub release, container registry, npm). Those are\n' +
    '  first exercised by a real release — which is why the manual route exists.\n',
);

process.exit(failed ? 1 : 0);

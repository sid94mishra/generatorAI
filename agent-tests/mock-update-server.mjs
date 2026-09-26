#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Mock update server + install-run checker (P3-06; 06 §8, §11 R5; 07 R-10).
//
// The auto-update path is the one part of a release that only runs on a
// user's machine, days after the build that produced it. This script serves
// a release directory as electron-updater's `generic` feed, checks the feed
// before a run, and reads the app's main log afterwards to confirm the install
// happened in the right order. Plain Node (no dependencies), the same on
// Windows, macOS and Linux.
//
//   node agent-tests/mock-update-server.mjs serve      [--dir <release dir>] [--port 8770]
//   node agent-tests/mock-update-server.mjs check      [--dir <release dir>] --installed <version>
//   node agent-tests/mock-update-server.mjs verify-log --expect-version <version> [--mode pill|quit] [--log <main.log>]
//
// `pnpm --filter @generatorai/desktop mock-update-server` runs `serve` with
// `--dir apps/desktop/release`.
//
// ── The per-OS install run (the lead, once per OS, at batch end) ─────────────
// Run every step on the OS under test. Versions below: A = the installed build,
// B = the update. Both builds point at the mock feed.
//
//  1. Build A: `GENERATORAI_UPDATE_URL=http://localhost:8770 pnpm package:desktop`
//     (PowerShell: `$env:GENERATORAI_UPDATE_URL='http://localhost:8770'`).
//     Install it from apps/desktop/release (Windows: the NSIS setup; macOS: the
//     dmg; Linux: the AppImage — `chmod +x`, run it from its file — and, as a
//     second pass, the deb or rpm). Move the release folder aside.
//  2. Build B: bump `version` in apps/desktop/package.json (e.g. 0.0.1-alpha.1 →
//     0.0.1-alpha.2; keep the channel), package again with the same env, then
//     rename apps/desktop/release to apps/desktop/release-next and revert the
//     version bump.
//  3. `node agent-tests/mock-update-server.mjs check --dir apps/desktop/release-next --installed <A>`
//     must pass: a manifest for this OS, version B > A, every file present with
//     the size and sha512 the manifest states.
//  4. `node agent-tests/mock-update-server.mjs serve --dir apps/desktop/release-next`
//     (leave it running; it logs every request).
//  5. Launch the installed A. It checks on startup and downloads B (the server
//     logs 200/206 for the installer). Then, with the window on screen:
//       - the "Restart to update" pill appears — title strip on Windows and on
//         Linux with GENERATORAI_LINUX_CUSTOM_TITLEBAR=1 (`titlebar-update-pill`),
//         sidebar footer on macOS and the Linux native frame
//         (`sidebar-update-pill`), a download icon in the rail when the
//         sidebar is collapsed (`rail-update`); its tooltip reads
//         "Update B is ready";
//       - Help ▸ "Check for Updates…" reads "Restart to Update (vB)";
//       - no native "update downloaded" dialog (the pill replaces it while the
//         window is visible; hide the window to the tray to see the dialog).
//  6. Click the pill. The app quits, the installer runs, and B starts by itself.
//     Then: `node agent-tests/mock-update-server.mjs verify-log --expect-version <B>`
//     It checks, in the last install attempt of the main log: the embedded
//     server was stopped (and not force-killed) before the installer started,
//     the installer started, the old process exited, and the next launch runs B.
//  7. Ordinary quit: reinstall A (step 1), let it download B, then quit from the
//     tray or the menu instead of the pill. electron-updater installs on the
//     quit's exit code 0. `verify-log --mode quit --expect-version <B>`.
//  8. Record the result per OS in 07 R-10 / the P3 review.
// Per-OS notes: macOS installs through Squirrel.Mac, which needs A and B signed
// with the same Developer ID (an unsigned pair fails with a code-signature
// error: that is a signing problem, not an updater one); the pill appears only
// once Squirrel.Mac has the update too. Linux AppImage must be started from the
// AppImage file ($APPIMAGE), and deb/rpm install through pkexec (a password
// prompt; cancelling it must bring A back — `verify-log` then reports the
// relaunch). Windows NSIS runs the installer after A has exited; a UAC prompt
// appears only for a per-machine install.
// ────────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = path.join(REPO, 'apps', 'desktop', 'release');
const DEFAULT_PORT = 8770;
/** electron-builder's productName: the packaged app's userData folder name. */
const PRODUCT_NAME = 'GeneratorAI';

const CONTENT_TYPES = {
  '.yml': 'text/yaml',
  '.zip': 'application/zip',
};

// ── serve ──────────────────────────────────────────────────────

/**
 * A static file server for `root` with byte ranges (differential downloads ask
 * for ranges of the blockmap; without them electron-updater silently falls back
 * to a full download). Refuses paths outside `root`.
 */
export function createMockUpdateServer({ root, log = () => {} }) {
  const base = path.resolve(root);
  return createServer((req, res) => {
    let requested;
    try {
      requested = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    const filePath = path.resolve(base, `.${requested}`);
    const rel = path.relative(base, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      log(`404 ${requested}`);
      res.writeHead(404).end('Not found');
      return;
    }
    const { size } = fs.statSync(filePath);
    const type = CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
    const range = parseRange(req.headers.range, size);
    if (range === 'invalid') {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    if (range) {
      log(`206 ${requested} ${range.from}-${range.to}`);
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${range.from}-${range.to}/${size}`,
        'Content-Length': range.to - range.from + 1,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath, { start: range.from, end: range.to }).pipe(res);
      return;
    }
    log(`200 ${requested} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  });
}

/** One `bytes=from-to` / `bytes=from-` / `bytes=-suffix` range, or null when absent. */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let from;
  let to;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    from = Math.max(0, size - suffix);
    to = size - 1;
  } else {
    from = Number(m[1]);
    to = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (from > to || from >= size) return 'invalid';
  return { from, to };
}

// ── check ──────────────────────────────────────────────────────

/** The manifests electron-updater's generic provider reads on this OS (`<channel>[-mac|-linux[-arm64]].yml`). */
export function manifestsForPlatform(names, platform = process.platform) {
  const yml = names.filter((n) => n.endsWith('.yml') && n !== 'builder-debug.yml' && !n.startsWith('builder-effective-config'));
  if (platform === 'darwin') return yml.filter((n) => n.endsWith('-mac.yml'));
  if (platform === 'linux') return yml.filter((n) => /-linux(-[a-z0-9]+)?\.yml$/.test(n));
  return yml.filter((n) => !n.endsWith('-mac.yml') && !/-linux(-[a-z0-9]+)?\.yml$/.test(n));
}

/** The fields of an electron-builder update manifest this check needs (no YAML dependency). */
export function parseManifest(text) {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)?.[1] ?? null;
  const files = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const url = /^\s*-\s+url:\s*['"]?(.+?)['"]?\s*$/.exec(line);
    if (url) {
      current = { url: url[1] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    const field = /^\s+(sha512|size):\s*['"]?(.+?)['"]?\s*$/.exec(line);
    if (field) current[field[1]] = field[1] === 'size' ? Number(field[2]) : field[2];
    else if (/^\S/.test(line)) current = null;
  }
  return { version, files };
}

/** Semver-ish comparison with prerelease tags (`0.0.1-alpha.2` > `0.0.1-alpha.1` < `0.0.1`). */
export function compareVersions(a, b) {
  const split = (v) => {
    const [main, pre] = String(v).replace(/^v/, '').split('-', 2);
    return { main: main.split('.').map(Number), pre: pre ? pre.split('.') : [] };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.main[i] ?? 0) - (y.main[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre.length === 0 || y.pre.length === 0) return Math.sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Math.sign(Number(p) - Number(q));
    if (pn !== qn) return pn ? -1 : 1;
    if (!pn && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Checks the feed in `dir` for this OS against the installed version. Returns problems (empty = ok). */
export function checkFeed({ dir, installed, platform = process.platform }) {
  const problems = [];
  const notes = [];
  if (!fs.existsSync(dir)) return { problems: [`${dir} does not exist — package the update build first.`], notes };
  const manifests = manifestsForPlatform(fs.readdirSync(dir), platform);
  if (manifests.length === 0) problems.push(`no update manifest for ${platform} in ${dir} (electron-updater would get a 404)`);
  for (const name of manifests) {
    const { version, files } = parseManifest(fs.readFileSync(path.join(dir, name), 'utf8'));
    notes.push(`${name}: version ${version ?? '?'}, ${files.length} file(s)`);
    if (!version) problems.push(`${name}: no version`);
    else if (installed && compareVersions(version, installed) <= 0) {
      problems.push(`${name}: version ${version} is not newer than the installed ${installed} — nothing would download`);
    }
    if (files.length === 0) problems.push(`${name}: lists no files`);
    for (const file of files) {
      const full = path.join(dir, file.url);
      if (!fs.existsSync(full)) {
        problems.push(`${name}: ${file.url} is missing`);
        continue;
      }
      const data = fs.readFileSync(full);
      if (file.size !== undefined && data.length !== file.size) problems.push(`${name}: ${file.url} is ${data.length} bytes, manifest says ${file.size}`);
      if (file.sha512 && createHash('sha512').update(data).digest('base64') !== file.sha512) {
        problems.push(`${name}: ${file.url} sha512 does not match the manifest`);
      }
    }
  }
  return { problems, notes };
}

// ── verify-log ─────────────────────────────────────────────────

/** Where the packaged app writes `main.log` (userData/logs) on each OS. */
export function defaultLogPath(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', PRODUCT_NAME, 'logs', 'main.log');
  if (platform === 'win32') return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), PRODUCT_NAME, 'logs', 'main.log');
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), PRODUCT_NAME, 'logs', 'main.log');
}

const LINE = /^(\S+) \[(DEBUG|INFO|WARN|ERROR)\] (.*)$/;

function parseLog(text) {
  return text
    .split(/\r?\n/)
    .map((raw) => LINE.exec(raw))
    .filter(Boolean)
    .map((m) => ({ ts: m[1], level: m[2], msg: m[3] }));
}

/**
 * Reads a main log and checks the last update install (06 §8 run): the
 * embedded server stopped gracefully before the installer ran, the installer
 * started, the old process exited, and the next launch runs `expectVersion`.
 *
 * `mode: 'pill'` (the pill / Help menu / dialog): Windows and Linux install
 * after the shutdown (`Installing update after the shutdown` → shutdown →
 * `Running the exit hand-off` → `Installer started; exiting`); macOS installs
 * first (`Installing update: quitAndInstall` → shutdown). `mode: 'quit'`: an
 * ordinary quit, where electron-updater installs on exit code 0 — only the
 * shutdown and the relaunch on the new version are visible in our log.
 */
export function verifyInstallLog(text, { expectVersion, mode = 'pill', platform = process.platform }) {
  const lines = parseLog(text);
  const steps = [];
  const fail = (message) => ({ ok: false, steps, message });

  const nativeFirst = platform === 'darwin';
  const installMarker = nativeFirst ? 'Installing update: quitAndInstall' : 'Installing update after the shutdown';
  let start;
  if (mode === 'pill') {
    start = lines.findLastIndex((l) => l.msg.startsWith(installMarker));
    if (start === -1) return fail(`no "${installMarker}" line — the install was never requested`);
    steps.push(`install requested at ${lines[start].ts}`);
  } else {
    // The last quit that is followed by a launch on the expected version.
    const launches = lines.flatMap((l, i) => (isLaunchOf(l, expectVersion) ? [i] : []));
    const launch = launches.at(-1);
    if (launch === undefined) return fail(`no "GeneratorAI starting" line with version ${expectVersion}`);
    start = lines.slice(0, launch).findLastIndex((l) => l.msg.startsWith('Quitting — shutting down embedded server'));
    if (start === -1) return fail('no quit before the launch on the new version');
  }

  const expected = [
    'Quitting — shutting down embedded server',
    'Stopping embedded server',
    'Shutdown complete — destroying tray',
    ...(mode === 'pill' && !nativeFirst ? ['Running the exit hand-off', 'Installer started; exiting'] : []),
    'Exiting',
  ];
  let at = start;
  for (const marker of expected) {
    const found = lines.findIndex((l, i) => i >= at && l.msg.startsWith(marker));
    if (found === -1) return fail(`missing "${marker}" after ${lines[at]?.ts ?? 'the start'}`);
    steps.push(`${marker} (${lines[found].ts})`);
    at = found;
  }
  const exitAt = at;
  const window = lines.slice(start, exitAt + 1);
  if (window.some((l) => l.msg.startsWith('Server did not exit in time; forcing kill'))) {
    return fail('the embedded server was force-killed, not stopped gracefully, before the installer ran');
  }
  if (window.some((l) => l.msg.startsWith('shutdown did not finish in 20s'))) {
    return fail('the shutdown hit its 20 s deadline');
  }
  const after = lines.slice(exitAt + 1);
  if (after.some((l) => l.msg.startsWith('The installer did not start after the shutdown'))) {
    return fail('the installer did not start; the app relaunched on the old version');
  }
  const next = after.find((l) => l.msg.startsWith('GeneratorAI starting'));
  if (!next) return fail('no launch after the install — the app did not come back');
  if (!isLaunchOf(next, expectVersion)) return fail(`the app came back on the wrong version: ${next.msg}`);
  steps.push(`came back on ${expectVersion} (${next.ts})`);
  return { ok: true, steps, message: 'install run verified' };
}

function isLaunchOf(line, version) {
  if (!line.msg.startsWith('GeneratorAI starting')) return false;
  const meta = line.msg.slice('GeneratorAI starting'.length).trim();
  try {
    return JSON.parse(meta).version === version;
  } catch {
    return false;
  }
}

// ── CLI ────────────────────────────────────────────────────────

function flag(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

function main(argv) {
  const [command = 'serve', ...args] = argv;
  if (command === 'serve') {
    const root = path.resolve(flag(args, 'dir', DEFAULT_DIR));
    const port = Number(flag(args, 'port', String(DEFAULT_PORT)));
    if (!fs.existsSync(root)) {
      console.error(`[mock-update] ${root} does not exist — package the app first.`);
      process.exit(1);
    }
    const server = createMockUpdateServer({ root, log: (m) => console.log(`[mock-update] ${m}`) });
    server.listen(port, '127.0.0.1', () => {
      const manifests = manifestsForPlatform(fs.readdirSync(root), process.platform);
      console.log(`[mock-update] serving ${root} on http://localhost:${port}`);
      console.log(
        manifests.length > 0
          ? `[mock-update] manifests for ${process.platform}: ${manifests.join(', ')}`
          : `[mock-update] no update manifest for ${process.platform} — electron-updater will get a 404`,
      );
      console.log(`[mock-update] build against it with GENERATORAI_UPDATE_URL=http://localhost:${port}`);
    });
    return;
  }
  if (command === 'check') {
    const dir = path.resolve(flag(args, 'dir', DEFAULT_DIR));
    const installed = flag(args, 'installed', undefined);
    if (!installed) console.warn('[mock-update] --installed <version> not given: the version is not compared');
    const { problems, notes } = checkFeed({ dir, installed });
    for (const n of notes) console.log(`[mock-update] ${n}`);
    for (const p of problems) console.error(`[mock-update] FAIL ${p}`);
    if (problems.length === 0) console.log('[mock-update] feed OK');
    process.exit(problems.length === 0 ? 0 : 1);
  }
  if (command === 'verify-log') {
    const expectVersion = flag(args, 'expect-version', undefined);
    if (!expectVersion) {
      console.error('[mock-update] --expect-version <version> is required');
      process.exit(2);
    }
    const mode = flag(args, 'mode', 'pill');
    if (mode !== 'pill' && mode !== 'quit') {
      console.error('[mock-update] --mode is pill or quit');
      process.exit(2);
    }
    const logPath = path.resolve(flag(args, 'log', defaultLogPath()));
    if (!fs.existsSync(logPath)) {
      console.error(`[mock-update] ${logPath} does not exist — pass --log`);
      process.exit(1);
    }
    const result = verifyInstallLog(fs.readFileSync(logPath, 'utf8'), { expectVersion, mode });
    for (const s of result.steps) console.log(`[mock-update]   ✓ ${s}`);
    console[result.ok ? 'log' : 'error'](`[mock-update] ${result.ok ? 'OK' : 'FAIL'} ${result.message} (${logPath})`);
    process.exit(result.ok ? 0 : 1);
  }
  console.error(`[mock-update] unknown command "${command}" (serve | check | verify-log)`);
  process.exit(2);
}

// Main-module guard that holds on Windows and under paths with spaces (D-48).
const invoked = process.argv[1] ? pathToFileURL(fs.realpathSync(process.argv[1])).href : '';
if (invoked === pathToFileURL(fs.realpathSync(fileURLToPath(import.meta.url))).href) {
  main(process.argv.slice(2));
}

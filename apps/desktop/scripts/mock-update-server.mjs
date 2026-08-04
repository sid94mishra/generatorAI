// ────────────────────────────────────────────────────────────────
// Serves a release directory as an update feed.
//
// The auto-update path is the one part of the release that only executes on a
// user's machine, days after the build that produced it. Nothing else in the
// pipeline exercises it: packaging writes `<channel>.yml`, the release job
// uploads it, and the first time anyone finds out whether electron-updater can
// actually read it is when a real client polls.
//
// Pointing a build at this server closes that gap:
//
//     node scripts/mock-update-server.mjs --dir release          # terminal 1
//     GENERATORAI_UPDATE_URL=http://localhost:8770 pnpm run package
//
// It is deliberately a plain static file server. electron-updater's generic
// provider only needs the manifest, the installer and byte-range requests for
// the blockmap, so anything more would be testing this file rather than the
// updater.
// ────────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktopRoot, flag('dir', 'release'));
const port = Number(flag('port', '8770'));

if (!fs.existsSync(root)) {
  console.error(`[mock-update] ${root} does not exist — package the app first.`);
  process.exit(1);
}

const CONTENT_TYPES = {
  '.yml': 'text/yaml',
  '.exe': 'application/octet-stream',
  '.dmg': 'application/octet-stream',
  '.zip': 'application/zip',
  '.blockmap': 'application/octet-stream',
  '.AppImage': 'application/octet-stream',
};

const server = createServer((req, res) => {
  // Reject anything that escapes the served directory. This listens on
  // localhost during a test, but a path-traversal bug is not worth having.
  const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const filePath = path.join(root, requested);
  if (path.relative(root, filePath).startsWith('..')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    console.log(`[mock-update] 404 ${requested}`);
    res.writeHead(404).end('Not found');
    return;
  }

  const { size } = fs.statSync(filePath);
  const type = CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';

  // Differential downloads ask for byte ranges of the blockmap; without this
  // electron-updater silently falls back to a full download and the feature
  // under test never runs.
  const range = req.headers.range;
  if (range) {
    const [start, end] = range.replace('bytes=', '').split('-');
    const from = Number(start);
    const to = end ? Number(end) : size - 1;
    console.log(`[mock-update] 206 ${requested} ${from}-${to}`);
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${from}-${to}/${size}`,
      'Content-Length': to - from + 1,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath, { start: from, end: to }).pipe(res);
    return;
  }

  console.log(`[mock-update] 200 ${requested} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  const manifests = fs
    .readdirSync(root)
    .filter((n) => n.endsWith('.yml') && n !== 'builder-debug.yml');

  console.log(`[mock-update] serving ${root} on http://localhost:${port}`);
  console.log(
    manifests.length > 0
      ? `[mock-update] manifests: ${manifests.join(', ')}`
      : '[mock-update] no update manifest present — electron-updater will get a 404',
  );
  console.log(`[mock-update] build against it with GENERATORAI_UPDATE_URL=http://localhost:${port}`);
});

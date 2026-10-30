// agent-tests/mock-update-server.mjs (P3-06): the feed server, the pre-run feed
// check and the post-run log verification the per-OS install run relies on.
// Pure Node; paths from os.tmpdir(), so it runs the same on every OS.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkFeed,
  compareVersions,
  createMockUpdateServer,
  defaultLogPath,
  manifestsForPlatform,
  parseManifest,
  parseRange,
  verifyInstallLog,
} from '../../agent-tests/mock-update-server.mjs';

let dir;
let server;
let base;

const INSTALLER = Buffer.from('0123456789abcdefghij');
const sha = (b) => createHash('sha512').update(b).digest('base64');

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gai-mock-update-'));
  fs.writeFileSync(path.join(dir, 'GeneratorAI-0.0.2-x64-setup.exe'), INSTALLER);
  fs.writeFileSync(
    path.join(dir, 'alpha.yml'),
    [
      'version: 0.0.2-alpha.2',
      'files:',
      '  - url: GeneratorAI-0.0.2-x64-setup.exe',
      `    sha512: ${sha(INSTALLER)}`,
      `    size: ${INSTALLER.length}`,
      'path: GeneratorAI-0.0.2-x64-setup.exe',
      `sha512: ${sha(INSTALLER)}`,
      "releaseDate: '2026-09-26T00:00:00.000Z'",
      '',
    ].join('\n'),
  );
  server = createMockUpdateServer({ root: dir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

function rawStatus(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: rawPath }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('serve', () => {
  it('serves the manifest and the installer, with byte ranges', async () => {
    const manifest = await fetch(`${base}/alpha.yml`);
    expect(manifest.status).toBe(200);
    expect(await manifest.text()).toContain('version: 0.0.2-alpha.2');
    const part = await fetch(`${base}/GeneratorAI-0.0.2-x64-setup.exe`, { headers: { Range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 2-5/${INSTALLER.length}`);
    expect(await part.text()).toBe('2345');
  });

  it('404s a missing file and never serves outside the release directory', async () => {
    expect((await fetch(`${base}/latest-mac.yml`)).status).toBe(404);
    // Raw paths: fetch would normalise the dot segments before sending.
    expect(await rawStatus('/..%2F..%2Fetc%2Fpasswd')).toBe(403);
    // Literal and %2e dot segments collapse at the root while parsing: looked up inside the release dir.
    expect(await rawStatus('/../../etc/passwd')).toBe(404);
    expect(await rawStatus('/%2e%2e/secret')).toBe(404);
  });

  it('parses ranges, rejecting unsatisfiable ones', () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange('bytes=0-', 10)).toEqual({ from: 0, to: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ from: 7, to: 9 });
    expect(parseRange('bytes=4-100', 10)).toEqual({ from: 4, to: 9 });
    expect(parseRange('bytes=12-', 10)).toBe('invalid');
    expect(parseRange('bytes=5-2', 10)).toBe('invalid');
    expect(parseRange('items=0-1', 10)).toBe('invalid');
  });
});

describe('check', () => {
  it('picks the manifest electron-updater reads on each OS', () => {
    const names = ['alpha.yml', 'alpha-mac.yml', 'alpha-linux.yml', 'alpha-linux-arm64.yml', 'builder-debug.yml'];
    expect(manifestsForPlatform(names, 'win32')).toEqual(['alpha.yml']);
    expect(manifestsForPlatform(names, 'darwin')).toEqual(['alpha-mac.yml']);
    expect(manifestsForPlatform(names, 'linux')).toEqual(['alpha-linux.yml', 'alpha-linux-arm64.yml']);
  });

  it('parses version and files', () => {
    const m = parseManifest(fs.readFileSync(path.join(dir, 'alpha.yml'), 'utf8'));
    expect(m.version).toBe('0.0.2-alpha.2');
    expect(m.files).toEqual([{ url: 'GeneratorAI-0.0.2-x64-setup.exe', sha512: sha(INSTALLER), size: INSTALLER.length }]);
  });

  it('compares prerelease versions the way electron-updater does', () => {
    expect(compareVersions('0.0.1-alpha.2', '0.0.1-alpha.1')).toBe(1);
    expect(compareVersions('0.0.1-alpha.10', '0.0.1-alpha.9')).toBe(1);
    expect(compareVersions('0.0.1', '0.0.1-alpha.9')).toBe(1);
    expect(compareVersions('0.0.1-alpha.1', '0.0.1-beta.1')).toBe(-1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('passes a good feed and names every problem of a bad one', () => {
    expect(checkFeed({ dir, installed: '0.0.2-alpha.1', platform: 'win32' }).problems).toEqual([]);
    expect(checkFeed({ dir, installed: '0.0.2-alpha.2', platform: 'win32' }).problems[0]).toMatch(/not newer/);
    expect(checkFeed({ dir, installed: '0.0.1', platform: 'darwin' }).problems[0]).toMatch(/no update manifest for darwin/);
  });
});

describe('verify-log', () => {
  const line = (t, msg, meta) => `2026-09-26T10:00:${String(t).padStart(2, '0')}.000Z [INFO] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`;
  const winPill = [
    line(0, 'GeneratorAI starting', { version: '0.0.1-alpha.1', platform: 'win32', packaged: true }),
    line(1, 'Installing update after the shutdown', { version: '0.0.1-alpha.2' }),
    line(2, 'Quitting — shutting down embedded server'),
    line(3, 'Stopping embedded server', { pid: 42 }),
    line(4, 'Shutdown complete — destroying tray'),
    line(5, 'Running the exit hand-off'),
    line(6, 'Installer started; exiting'),
    line(7, 'Exiting'),
    line(30, 'GeneratorAI starting', { version: '0.0.1-alpha.2', platform: 'win32', packaged: true }),
  ];

  it('Windows/Linux pill: shutdown, then the installer, then the new version', () => {
    const r = verifyInstallLog(winPill.join('\n'), { expectVersion: '0.0.1-alpha.2', platform: 'win32' });
    expect(r.ok, r.message).toBe(true);
    expect(r.steps.at(-1)).toMatch(/came back on 0.0.1-alpha.2/);
  });

  it('fails when the server was force-killed, the installer did not start, or the old version came back', () => {
    const killed = [...winPill.slice(0, 4), line(3, 'Server did not exit in time; forcing kill'), ...winPill.slice(4)];
    expect(verifyInstallLog(killed.join('\n'), { expectVersion: '0.0.1-alpha.2', platform: 'linux' }).message).toMatch(/force-killed/);
    const oldBack = [...winPill.slice(0, -1), line(30, 'GeneratorAI starting', { version: '0.0.1-alpha.1' })];
    expect(verifyInstallLog(oldBack.join('\n'), { expectVersion: '0.0.1-alpha.2', platform: 'win32' }).message).toMatch(/wrong version/);
    const noInstaller = winPill.filter((l) => !l.includes('Installer started'));
    expect(verifyInstallLog(noInstaller.join('\n'), { expectVersion: '0.0.1-alpha.2', platform: 'win32' }).ok).toBe(false);
    expect(verifyInstallLog(winPill.slice(0, -1).join('\n'), { expectVersion: '0.0.1-alpha.2', platform: 'win32' }).message).toMatch(
      /did not come back/,
    );
  });

  it('macOS pill: quitAndInstall first, then the ordinary shutdown', () => {
    const mac = [
      line(1, 'Installing update: quitAndInstall', { version: '0.0.1-alpha.2' }),
      line(2, 'Quitting — shutting down embedded server'),
      line(3, 'Stopping embedded server', { pid: 42 }),
      line(4, 'Shutdown complete — destroying tray'),
      line(7, 'Exiting'),
      line(30, 'GeneratorAI starting', { version: '0.0.1-alpha.2', platform: 'darwin', packaged: true }),
    ];
    expect(verifyInstallLog(mac.join('\n'), { expectVersion: '0.0.1-alpha.2', platform: 'darwin' }).ok).toBe(true);
  });

  it('ordinary quit: a graceful shutdown followed by a launch on the new version', () => {
    const quit = [
      line(0, 'GeneratorAI starting', { version: '0.0.1-alpha.1' }),
      line(2, 'Quitting — shutting down embedded server'),
      line(3, 'Stopping embedded server', { pid: 42 }),
      line(4, 'Shutdown complete — destroying tray'),
      line(7, 'Exiting'),
      line(30, 'GeneratorAI starting', { version: '0.0.1-alpha.2' }),
    ];
    expect(verifyInstallLog(quit.join('\n'), { expectVersion: '0.0.1-alpha.2', mode: 'quit', platform: 'linux' }).ok).toBe(true);
    expect(verifyInstallLog(quit.join('\n'), { expectVersion: '0.0.1-alpha.3', mode: 'quit', platform: 'linux' }).ok).toBe(false);
  });

  it('knows the packaged app log location per OS', () => {
    expect(defaultLogPath('darwin', {}, '/Users/u')).toBe(path.join('/Users/u', 'Library', 'Application Support', 'GeneratorAI', 'logs', 'main.log'));
    expect(defaultLogPath('win32', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'C:\\Users\\u')).toBe(
      path.join('C:\\Users\\u\\AppData\\Roaming', 'GeneratorAI', 'logs', 'main.log'),
    );
    expect(defaultLogPath('linux', {}, '/home/u')).toBe(path.join('/home/u', '.config', 'GeneratorAI', 'logs', 'main.log'));
  });
});

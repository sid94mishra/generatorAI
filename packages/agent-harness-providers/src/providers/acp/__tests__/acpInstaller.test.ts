// docs/acp ACP-6 — binary installs end to end on real archives: extraction (zip, tar.gz), the
// zip-slip guard, sha256 verification and the "unverified" label, chmod, the layout and the
// launch spec. Archives are built in the test (no network, nothing third-party is run).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {
  extractTar,
  extractZip,
  installBinaryAgent,
  launchFromManifest,
  listInstalledVersions,
  readInstallManifest,
  uninstallAgent,
  UnsafeArchiveError,
} from '../registry/installer.js';

// ── tiny archive writers ─────────────────────────────────────────

function tarEntry(name: string, body: Buffer, opts: { mode?: number; type?: '0' | '2' | '5'; link?: string } = {}): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(`${(opts.mode ?? 0o644).toString(8).padStart(7, '0')}\0`, 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write(opts.type ?? '0', 156, 1, 'ascii');
  if (opts.link) header.write(opts.link, 157, 100, 'utf8');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const b of header) sum += b;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, pad]);
}

function tarGz(entries: Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A stored (uncompressed) zip; `mode` lands in the unix external attributes. */
function zip(files: Array<{ name: string; body: Buffer; mode?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.body.length, 18);
    local.writeUInt32LE(f.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(f.body.length, 20);
    central.writeUInt32LE(f.body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((((f.mode ?? 0o100644) & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, f.body);
    centrals.push(central, name);
    offset += local.length + name.length + f.body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const fetchOf = (body: Buffer): typeof fetch =>
  (async () => new Response(body, { status: 200, headers: { 'content-length': String(body.length) } })) as unknown as typeof fetch;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'gai-acp-install-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('extraction and the zip-slip guard', () => {
  it('extracts a tar.gz, keeping modes, and refuses an entry or a link that leaves the directory', async () => {
    const good = path.join(dir, 'good.tar.gz');
    await import('node:fs/promises').then((fs) => fs.writeFile(good, tarGz([tarEntry('pkg/bin/agent', Buffer.from('#!/bin/sh\n'), { mode: 0o755 })])));
    await extractTar(good, path.join(dir, 'out'), 'gzip');
    expect(await readFile(path.join(dir, 'out', 'pkg', 'bin', 'agent'), 'utf8')).toBe('#!/bin/sh\n');

    for (const [name, entry] of [
      ['climb', tarEntry('../evil.txt', Buffer.from('x'))],
      ['nested-climb', tarEntry('pkg/../../evil.txt', Buffer.from('x'))],
      ['symlink-out', tarEntry('pkg/link', Buffer.alloc(0), { type: '2', link: '../../evil.txt' })],
    ] as const) {
      const file = path.join(dir, `${name}.tar.gz`);
      await import('node:fs/promises').then((fs) => fs.writeFile(file, tarGz([entry])));
      const dest = path.join(dir, `x-${name}`);
      await expect(extractTar(file, dest, 'gzip'), name).rejects.toBeInstanceOf(UnsafeArchiveError);
      expect(existsSync(path.join(dir, 'evil.txt')), name).toBe(false);
    }
  });

  it('extracts a zip with its unix modes and refuses a zip-slip entry', async () => {
    const good = path.join(dir, 'good.zip');
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(good, zip([{ name: 'dist/agent', body: Buffer.from('bin'), mode: 0o100755 }, { name: 'README', body: Buffer.from('r') }])),
    );
    await extractZip(good, path.join(dir, 'out'));
    expect(await readFile(path.join(dir, 'out', 'dist', 'agent'), 'utf8')).toBe('bin');
    if (process.platform !== 'win32') expect((await stat(path.join(dir, 'out', 'dist', 'agent'))).mode & 0o111).not.toBe(0);

    const evil = path.join(dir, 'evil.zip');
    await import('node:fs/promises').then((fs) => fs.writeFile(evil, zip([{ name: '../evil.txt', body: Buffer.from('x') }])));
    await expect(extractZip(evil, path.join(dir, 'x'))).rejects.toThrow();
    expect(existsSync(path.join(dir, 'evil.txt'))).toBe(false);
  });
});

describe('installBinaryAgent', () => {
  const root = () => path.join(dir, 'agents');
  const archive = () => tarGz([tarEntry('goose-package/goose', Buffer.from('#!/bin/sh\necho hi\n'), { mode: 0o644 })]);

  it('verifies sha256, extracts into <root>/<id>/<version>, chmods the command and writes the manifest', async () => {
    const body = archive();
    const progress: string[] = [];
    const manifest = await installBinaryAgent({
      root: root(),
      id: 'goose',
      version: '1.59.0',
      key: 'linux-x86_64',
      target: { archive: 'https://example.test/goose.tar.gz', cmd: './goose-package\\goose', args: ['acp'], env: { A: '1' }, sha256: sha256(body) },
      fetchImpl: fetchOf(body),
      onProgress: (p) => progress.push(p.phase),
      platform: 'linux',
    });
    expect(manifest).toMatchObject({ id: 'goose', version: '1.59.0', kind: 'binary', unverified: false, command: 'goose-package/goose', args: ['acp'] });
    expect(progress).toEqual(expect.arrayContaining(['downloading', 'verifying', 'extracting', 'finishing']));
    expect(await readInstallManifest(root(), 'goose', '1.59.0')).toEqual(manifest);
    const launch = launchFromManifest(root(), manifest);
    expect(launch.command).toBe(path.join(root(), 'goose', '1.59.0', 'goose-package', 'goose'));
    expect(launch).toMatchObject({ args: ['acp'], env: { A: '1' }, cwd: path.join(root(), 'goose', '1.59.0') });
    if (process.platform !== 'win32') expect((await stat(launch.command)).mode & 0o111).not.toBe(0);
    // No staging leftovers beside the version.
    expect((await listInstalledVersions(root(), 'goose')).map((m) => m.version)).toEqual(['1.59.0']);
    expect(await import('node:fs/promises').then((fs) => fs.readdir(path.join(root(), 'goose')))).toEqual(['1.59.0']);

    await uninstallAgent(root(), 'goose');
    expect(existsSync(path.join(root(), 'goose'))).toBe(false);
  });

  it('refuses a download that does not match the registry sha256, installing nothing', async () => {
    await expect(installBinaryAgent({
      root: root(), id: 'goose', version: '1.0.0', key: 'linux-x86_64',
      target: { archive: 'https://example.test/goose.tar.gz', cmd: './goose-package/goose', sha256: 'a'.repeat(64) },
      fetchImpl: fetchOf(archive()),
    })).rejects.toThrow(/sha256/);
    expect(await listInstalledVersions(root(), 'goose')).toEqual([]);
    expect(await import('node:fs/promises').then((fs) => fs.readdir(path.join(root(), 'goose')))).toEqual([]);
  });

  it('labels an install without a registry sha256 as unverified; a raw binary is saved as its cmd', async () => {
    const m = await installBinaryAgent({
      root: root(), id: 'sigit', version: '1.7.10', key: 'linux-aarch64',
      target: { archive: 'https://example.test/sigit-linux-arm64', cmd: './sigit-linux-arm64' },
      fetchImpl: fetchOf(Buffer.from('ELF')),
    });
    expect(m).toMatchObject({ unverified: true, command: 'sigit-linux-arm64' });
    expect(await readFile(launchFromManifest(root(), m).command, 'utf8')).toBe('ELF');
  });

  it('fails when the archive has no such command, and when the archive format is refused', async () => {
    await expect(installBinaryAgent({
      root: root(), id: 'x', version: '1', key: 'linux-x86_64',
      target: { archive: 'https://example.test/x.tar.gz', cmd: './missing' },
      fetchImpl: fetchOf(archive()),
    })).rejects.toThrow(/no "\.\/missing"/);
    await expect(installBinaryAgent({
      root: root(), id: 'x', version: '1', key: 'darwin-aarch64',
      target: { archive: 'https://example.test/x.dmg', cmd: './x' },
      fetchImpl: fetchOf(Buffer.from('')),
    })).rejects.toThrow(/not supported/);
  });
});

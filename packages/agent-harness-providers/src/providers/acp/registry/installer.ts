// ────────────────────────────────────────────────────────────────
// Installing ACP Registry agents, on every OS (docs/acp ACP-6).
//
// Layout: `<root>/<id>/<version>/` (root = `<server data dir>/acp/agents`),
// with an install manifest `.gai-acp-install.json` in each version directory.
// Work happens in a staging directory beside it and is renamed into place, so
// a half-extracted or half-installed agent is never found and run.
//
// binary: download (progress, idle timeout) → sha256 against the registry (no
//   sha256 → the install is labelled unverified) → extract with JS extractors
//   (zip: yauzl; tar.gz: tar; tar.bz2: unbzip2-stream + tar; raw: copied) with
//   a zip-slip guard on every entry and link → `chmod 0755` the command →
//   the command must resolve inside the install directory.
// npx: the system Node (login-shell PATH; ≥ 18) runs npm's own CLI
//   (`node npm-cli.js`, so no `npm.cmd` on Windows) for
//   `npm install <pkg@ver> --save-exact --prefix <dir>`; the agent then runs as
//   `node <package bin>` — never `npx` (no network on launch, no shim).
// uvx: not supported (shown in the catalogue, not installable).
//
// No SDK import (W41): the server loads this module through the package barrel.
// The archive libraries are imported on first use.
// ────────────────────────────────────────────────────────────────

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { Entry as ZipEntry, ZipFile } from 'yauzl';
import { buildChildEnv } from '@generatorai/shared';
import { isPathInside, resolveAgentCmd, resolveSpawnTarget, safeArchiveEntryPath } from '../launch.js';
import type { AcpBinaryTarget, AcpPackageDistribution, AcpPlatformKey } from './schema.js';

const execFileAsync = promisify(execFile);

export const INSTALL_MANIFEST = '.gai-acp-install.json';
/** Minimum Node.js major for npx agents. */
export const MIN_NODE_MAJOR = 18;
/** A download that receives nothing for this long is abandoned. */
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
/** npm gets this long for one install. */
const NPM_TIMEOUT_MS = 15 * 60_000;

export interface AcpInstallManifest {
  id: string;
  version: string;
  kind: 'binary' | 'npx';
  installedAt: number;
  /** No sha256 was available to verify the download (binary only). */
  unverified: boolean;
  /**
   * binary: the command, relative to the version directory (`/` separators).
   * npx: the package's bin script, relative to the version directory.
   */
  command: string;
  args: string[];
  env: Record<string, string>;
  platformKey?: AcpPlatformKey;
  /** npx: the package spec installed. */
  package?: string;
}

export interface AcpInstallProgressEvent {
  phase: 'resolving' | 'downloading' | 'verifying' | 'extracting' | 'npm' | 'finishing';
  receivedBytes: number;
  totalBytes?: number;
}

/** A version string as a directory name (`/`, `:` … replaced). */
export function versionDirName(version: string): string {
  const safe = version.replace(/[^A-Za-z0-9._+-]/g, '_');
  return safe === '' || safe === '.' || safe === '..' ? `v_${safe.replace(/\./g, '_')}` : safe;
}

export function agentInstallDir(root: string, id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`"${id}" is not an agent id.`);
  return path.join(root, id);
}

export function versionInstallDir(root: string, id: string, version: string): string {
  return path.join(agentInstallDir(root, id), versionDirName(version));
}

/** The manifest of an installed version, or null. */
export async function readInstallManifest(root: string, id: string, version: string): Promise<AcpInstallManifest | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(versionInstallDir(root, id, version), INSTALL_MANIFEST), 'utf8')) as AcpInstallManifest;
    return raw && raw.id === id && typeof raw.command === 'string' ? raw : null;
  } catch {
    return null;
  }
}

/** Every installed version of an agent (newest install first). */
export async function listInstalledVersions(root: string, id: string): Promise<AcpInstallManifest[]> {
  let names: string[];
  try {
    names = await readdir(agentInstallDir(root, id));
  } catch {
    return [];
  }
  const out: AcpInstallManifest[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try {
      const m = JSON.parse(await readFile(path.join(agentInstallDir(root, id), name, INSTALL_MANIFEST), 'utf8')) as AcpInstallManifest;
      if (m?.id === id) out.push(m);
    } catch { /* not an install */ }
  }
  return out.sort((a, b) => b.installedAt - a.installedAt);
}

/** Remove every installed version of an agent. */
export async function uninstallAgent(root: string, id: string): Promise<void> {
  await rm(agentInstallDir(root, id), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

/** Remove every version but `keep` (best effort: a running binary on Windows may hold its directory). */
export async function removeOtherVersions(root: string, id: string, keep: string): Promise<void> {
  const dir = agentInstallDir(root, id);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((n) => n !== versionDirName(keep))
      .map((n) => rm(path.join(dir, n), { recursive: true, force: true }).catch(() => undefined)),
  );
}

// ── Launch ───────────────────────────────────────────────────────

export interface AcpLaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

/** How to run an installed agent. npx agents need the Node.js to run them with. */
export function launchFromManifest(root: string, manifest: AcpInstallManifest, nodePath?: string): AcpLaunchSpec {
  const dir = versionInstallDir(root, manifest.id, manifest.version);
  const entry = resolveAgentCmd(dir, manifest.command);
  if (manifest.kind === 'npx') {
    if (!nodePath) throw new Error('Node.js is needed to run this agent and was not found.');
    return { command: nodePath, args: [entry, ...manifest.args], env: { ...manifest.env }, cwd: dir };
  }
  return { command: entry, args: [...manifest.args], env: { ...manifest.env }, cwd: dir };
}

// ── Archives ─────────────────────────────────────────────────────

export type ArchiveKind = 'zip' | 'tar.gz' | 'tar.bz2' | 'raw';

/** The archive kind of a registry URL; null for a format that is refused (installers, xz, bare tar). */
export function archiveKindOf(url: string): ArchiveKind | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  if (pathname.endsWith('.zip')) return 'zip';
  if (pathname.endsWith('.tar.gz') || pathname.endsWith('.tgz')) return 'tar.gz';
  if (pathname.endsWith('.tar.bz2') || pathname.endsWith('.tbz2')) return 'tar.bz2';
  if (/\.(tar\.xz|txz|tar|xz|bz2|gz|7z|rar|dmg|pkg|deb|rpm|msi|appimage)$/.test(pathname)) return null;
  return 'raw';
}

/** Thrown when an archive tries to write outside its directory. */
export class UnsafeArchiveError extends Error {
  constructor(readonly entries: string[]) {
    super(`The archive contains entries outside its directory (${entries.slice(0, 3).join(', ')}); nothing was installed.`);
    this.name = 'UnsafeArchiveError';
  }
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

/** A link target (relative to the link's directory) must stay inside `root`. */
function linkTargetInside(root: string, linkPath: string, target: string): boolean {
  if (path.isAbsolute(target) || /^[a-zA-Z]:/.test(target)) return false;
  const resolved = path.resolve(path.dirname(linkPath), target);
  return resolved === path.resolve(root) || isPathInside(root, resolved);
}

/** Extract a zip with yauzl; every entry and symlink must stay inside `dest`. */
export async function extractZip(file: string, dest: string): Promise<void> {
  const yauzl = await import('yauzl');
  await mkdir(dest, { recursive: true });
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true, decodeStrings: true, validateEntrySizes: true }, (err, z) =>
      err || !z ? reject(err ?? new Error('could not open the zip')) : resolve(z),
    );
  });
  const unsafe: string[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', (entry: ZipEntry) => {
      void (async () => {
        const target = safeArchiveEntryPath(dest, entry.fileName);
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const type = mode & S_IFMT;
        if (!target) {
          unsafe.push(entry.fileName);
          zip.readEntry();
          return;
        }
        if (entry.fileName.endsWith('/') || type === S_IFDIR) {
          await mkdir(target, { recursive: true });
          zip.readEntry();
          return;
        }
        await mkdir(path.dirname(target), { recursive: true });
        const stream = await new Promise<Readable>((res, rej) =>
          zip.openReadStream(entry, (err, s) => (err || !s ? rej(err ?? new Error('unreadable entry')) : res(s))),
        );
        if (type === S_IFLNK) {
          const chunks: Buffer[] = [];
          for await (const c of stream) chunks.push(c as Buffer);
          const linkTarget = Buffer.concat(chunks).toString('utf8');
          if (!linkTargetInside(dest, target, linkTarget)) unsafe.push(`${entry.fileName} -> ${linkTarget}`);
          else await symlink(linkTarget, target).catch(() => undefined);
        } else {
          await pipeline(stream, createWriteStream(target, { mode: (mode & 0o777) || 0o644 }));
        }
        zip.readEntry();
      })().catch(reject);
    });
    zip.readEntry();
  });
  if (unsafe.length > 0) throw new UnsafeArchiveError(unsafe);
}

/** Extract a tar (`compression` picks the decoder); every entry and link must stay inside `dest`. */
export async function extractTar(file: string, dest: string, compression: 'gzip' | 'bzip2'): Promise<void> {
  const tar = await import('tar');
  await mkdir(dest, { recursive: true });
  const unsafe: string[] = [];
  const filter = (entryPath: string, entry: { type?: string; linkpath?: string } | unknown): boolean => {
    const target = safeArchiveEntryPath(dest, entryPath);
    if (!target) {
      unsafe.push(entryPath);
      return false;
    }
    const e = entry as { type?: string; linkpath?: string };
    if ((e.type === 'SymbolicLink' || e.type === 'Link') && e.linkpath) {
      const ok = e.type === 'Link'
        ? safeArchiveEntryPath(dest, e.linkpath) !== null
        : linkTargetInside(dest, target, e.linkpath);
      if (!ok) {
        unsafe.push(`${entryPath} -> ${e.linkpath}`);
        return false;
      }
    }
    return true;
  };
  const opts = { cwd: dest, filter, strict: true, preservePaths: false, preserveOwner: false } as const;
  if (compression === 'gzip') {
    await tar.x({ ...opts, file });
  } else {
    const { default: unbzip2 } = await import('unbzip2-stream');
    await pipeline(createReadStream(file), unbzip2() as unknown as NodeJS.ReadWriteStream, tar.x(opts) as unknown as NodeJS.WritableStream);
  }
  if (unsafe.length > 0) throw new UnsafeArchiveError(unsafe);
}

// ── Download ─────────────────────────────────────────────────────

/** Download `url` to `file`, reporting progress; returns the sha256 (hex) of the bytes. */
export async function downloadFile(
  url: string,
  file: string,
  opts: { fetchImpl?: typeof fetch; onProgress?: (received: number, total: number | undefined) => void } = {},
): Promise<string> {
  const controller = new AbortController();
  let idle: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new Error('the download stalled')), DOWNLOAD_IDLE_TIMEOUT_MS);
    idle.unref?.();
  };
  arm();
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Downloading ${url} failed (HTTP ${res.status}).`);
    const total = Number(res.headers.get('content-length')) || undefined;
    const hash = createHash('sha256');
    let received = 0;
    let lastReport = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        arm();
        hash.update(chunk);
        received += chunk.length;
        if (received - lastReport > 1024 * 1024 || received === total) {
          lastReport = received;
          opts.onProgress?.(received, total);
        }
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(file));
    opts.onProgress?.(received, total);
    return hash.digest('hex');
  } finally {
    clearTimeout(idle);
  }
}

// ── Install ──────────────────────────────────────────────────────

async function stagingDir(root: string, id: string, version: string): Promise<string> {
  const dir = path.join(agentInstallDir(root, id), `.staging-${versionDirName(version)}-${process.pid}-${Date.now()}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Move a finished staging directory into `<root>/<id>/<version>` and write its manifest. */
async function commit(root: string, staging: string, manifest: AcpInstallManifest): Promise<AcpInstallManifest> {
  await writeFile(path.join(staging, INSTALL_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const dest = versionInstallDir(root, manifest.id, manifest.version);
  await rm(dest, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  await rename(staging, dest);
  return manifest;
}

export interface InstallBinaryOptions {
  root: string;
  id: string;
  version: string;
  key: AcpPlatformKey;
  target: AcpBinaryTarget;
  fetchImpl?: typeof fetch;
  onProgress?: (p: AcpInstallProgressEvent) => void;
  platform?: NodeJS.Platform;
}

/** Download, verify, extract and commit a binary distribution. */
export async function installBinaryAgent(opts: InstallBinaryOptions): Promise<AcpInstallManifest> {
  const kind = archiveKindOf(opts.target.archive);
  if (!kind) throw new Error(`The agent's archive format is not supported (${opts.target.archive}).`);
  // The download sits beside the staging directory, so the staging directory holds exactly the install.
  const staging = await stagingDir(opts.root, opts.id, opts.version);
  const download = `${staging}.download`;
  try {
    opts.onProgress?.({ phase: 'downloading', receivedBytes: 0 });
    const sha = await downloadFile(opts.target.archive, download, {
      fetchImpl: opts.fetchImpl,
      onProgress: (received, total) => opts.onProgress?.({ phase: 'downloading', receivedBytes: received, ...(total ? { totalBytes: total } : {}) }),
    });
    opts.onProgress?.({ phase: 'verifying', receivedBytes: 0 });
    const expected = opts.target.sha256?.toLowerCase();
    if (expected && sha !== expected) {
      throw new Error(`The download does not match the registry's sha256 (expected ${expected.slice(0, 12)}…, got ${sha.slice(0, 12)}…); nothing was installed.`);
    }
    opts.onProgress?.({ phase: 'extracting', receivedBytes: 0 });
    if (kind === 'zip') await extractZip(download, staging);
    else if (kind === 'tar.gz') await extractTar(download, staging, 'gzip');
    else if (kind === 'tar.bz2') await extractTar(download, staging, 'bzip2');
    else {
      const dest = resolveAgentCmd(staging, opts.target.cmd);
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(download, dest);
    }

    const command = resolveAgentCmd(staging, opts.target.cmd);
    const info = await stat(command).catch(() => null);
    if (!info?.isFile()) throw new Error(`The archive has no "${opts.target.cmd}" to run.`);
    if ((opts.platform ?? process.platform) !== 'win32') await chmod(command, 0o755);

    opts.onProgress?.({ phase: 'finishing', receivedBytes: 0 });
    return await commit(opts.root, staging, {
      id: opts.id,
      version: opts.version,
      kind: 'binary',
      installedAt: Date.now(),
      unverified: !expected,
      command: path.relative(staging, command).split(path.sep).join('/'),
      args: opts.target.args ?? [],
      env: opts.target.env ?? {},
      platformKey: opts.key,
    });
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  } finally {
    await rm(download, { force: true }).catch(() => undefined);
  }
}

// ── npx (system Node + npm) ──────────────────────────────────────

export interface NodeRuntime {
  node: string;
  version: string;
  /** How to run npm: `node npm-cli.js` when found next to Node, else the npm launcher. */
  npm: { command: string; args: string[] };
}

/** `name@1.2.3` / `@scope/name@1.2.3` → its parts. */
export function parsePackageSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf('@');
  if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  return { name: spec };
}

/** The system Node.js (on the login-shell PATH the desktop app restores) and its npm. Throws a user-facing reason. */
export async function findNodeRuntime(env: NodeJS.ProcessEnv = process.env, minMajor = MIN_NODE_MAJOR): Promise<NodeRuntime> {
  const { resolveOnPath } = await import('@generatorai/core');
  const node = await resolveOnPath('node', env);
  if (!node) throw new Error('Node.js was not found on PATH. Install Node.js 18 or later to use npm-distributed agents.');
  const { stdout } = await execFileAsync(node, ['--version'], { timeout: 15_000, windowsHide: true });
  const version = stdout.trim();
  const major = Number(/^v(\d+)/.exec(version)?.[1]);
  if (!Number.isFinite(major) || major < minMajor) {
    throw new Error(`Node.js ${minMajor} or later is needed for npm-distributed agents (found ${version || 'an unknown version'}).`);
  }
  const dirs = new Set<string>([path.dirname(node)]);
  try { dirs.add(path.dirname(await realpath(node))); } catch { /* keep the PATH entry */ }
  for (const dir of dirs) {
    for (const cli of [
      path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ]) {
      if ((await stat(cli).catch(() => null))?.isFile()) return { node, version, npm: { command: node, args: [cli] } };
    }
  }
  const npm = await resolveOnPath('npm', env);
  if (!npm) throw new Error('npm was not found next to Node.js or on PATH.');
  return { node, version, npm: { command: npm, args: [] } };
}

/** Run npm with a minimal environment (postinstall scripts are third-party code: no server secrets). */
async function runNpm(runtime: NodeRuntime, args: string[], cwd: string): Promise<void> {
  const target = resolveSpawnTarget(runtime.npm.command, [...runtime.npm.args, ...args]);
  const env = buildChildEnv({
    passthrough: ['npm_config_registry', 'NPM_CONFIG_REGISTRY', 'npm_config_cache', 'NPM_CONFIG_USERCONFIG', 'npm_config_userconfig'],
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(target.file, target.args, {
      cwd,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      ...(target.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (c: string) => { stderr = (stderr + c).slice(-4000); });
    const timer = setTimeout(() => child.kill(), NPM_TIMEOUT_MS);
    timer.unref?.();
    child.once('error', (err) => { clearTimeout(timer); reject(err); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`npm install failed (exit ${code}): ${stderr.trim().split('\n').slice(-5).join(' ')}`));
    });
  });
}

/** The runnable script of an installed npm package (`bin`: the one named like the package, else the only/first). */
export async function packageBinEntry(packageDir: string, packageName: string): Promise<string> {
  const pkg = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8')) as { bin?: string | Record<string, string>; name?: string };
  let rel: string | undefined;
  if (typeof pkg.bin === 'string') rel = pkg.bin;
  else if (pkg.bin && typeof pkg.bin === 'object') {
    const unscoped = packageName.includes('/') ? packageName.slice(packageName.indexOf('/') + 1) : packageName;
    rel = pkg.bin[unscoped] ?? Object.values(pkg.bin)[0];
  }
  if (!rel) throw new Error(`${packageName} has no command to run (no "bin" in its package.json).`);
  return resolveAgentCmd(packageDir, rel);
}

export interface InstallNpxOptions {
  root: string;
  id: string;
  version: string;
  dist: AcpPackageDistribution;
  runtime: NodeRuntime;
  onProgress?: (p: AcpInstallProgressEvent) => void;
}

/** `npm install <pkg@ver> --save-exact --prefix <staging>`, then commit with the package's bin as the command. */
export async function installNpxAgent(opts: InstallNpxOptions): Promise<AcpInstallManifest> {
  const { name } = parsePackageSpec(opts.dist.package);
  const staging = await stagingDir(opts.root, opts.id, opts.version);
  try {
    await writeFile(path.join(staging, 'package.json'), `${JSON.stringify({ name: `gai-acp-${opts.id}`, private: true }, null, 2)}\n`);
    opts.onProgress?.({ phase: 'npm', receivedBytes: 0 });
    await runNpm(
      opts.runtime,
      ['install', opts.dist.package, '--save-exact', '--prefix', staging, '--no-fund', '--no-audit', '--no-update-notifier', '--omit=dev', '--loglevel=error'],
      staging,
    );
    opts.onProgress?.({ phase: 'finishing', receivedBytes: 0 });
    const packageDir = path.join(staging, 'node_modules', ...name.split('/'));
    const bin = await packageBinEntry(packageDir, name);
    const rel = path.relative(staging, bin).split(path.sep).join('/');
    return await commit(opts.root, staging, {
      id: opts.id,
      version: opts.version,
      kind: 'npx',
      installedAt: Date.now(),
      unverified: false,
      command: rel,
      args: opts.dist.args ?? [],
      env: opts.dist.env ?? {},
      package: opts.dist.package,
    });
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

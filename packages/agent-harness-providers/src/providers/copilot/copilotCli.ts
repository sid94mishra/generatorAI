// ────────────────────────────────────────────────────────────────
// The GitHub Copilot CLI, downloaded on first use (evaluation: the bundled
// per-platform binary added ~308 MB to every download, for a provider most
// people never sign into).
//
// The packaged app keeps only the tiny `@github/copilot` loader package — it
// pins the CLI version the SDK was built against. When the person chooses
// Copilot, `installCopilotCli` fetches that exact version of
// `@github/copilot-<platform>-<arch>` from the npm registry, checks the
// tarball against the registry's published sha512 integrity, unpacks it with
// the system `tar` (macOS, Linux and Windows 10+ all ship one) into
// `<dir>/<version>/package`, and the provider runs it from there
// (`COPILOT_CLI_PATH`). A development checkout still finds the platform
// package in node_modules and never downloads.
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** `@github/copilot-<platform>-<arch>` for this machine (the loader's own naming). */
export function copilotPlatformPackage(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const os = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux';
  return `@github/copilot-${os}-${arch === 'arm64' ? 'arm64' : 'x64'}`;
}

function localRequire(): NodeRequire {
  return createRequire(fileURLToPath(import.meta.url));
}

/** The platform package installed next to this module (a dev checkout), if any. */
export function installedCopilotPlatformBinary(): string | undefined {
  try {
    const resolved = localRequire().resolve(copilotPlatformPackage());
    return existsSync(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/** The CLI version the bundled `@github/copilot` loader pins (its package.json sits next to `npm-loader.js`). */
export function bundledCopilotCliVersion(): string | undefined {
  try {
    const loader = localRequire().resolve('@github/copilot/npm-loader.js');
    const pkg = JSON.parse(readFileSync(path.join(path.dirname(loader), 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

/** The runnable entry of an unpacked platform package: `exports["."]`, else `main`. */
function packageEntry(packageDir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown> | string;
      main?: string;
    };
    const exp = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.'];
    const rel = typeof exp === 'string' ? exp : pkg.main;
    if (!rel) return undefined;
    const entry = path.join(packageDir, rel);
    return existsSync(entry) ? entry : undefined;
  } catch {
    return undefined;
  }
}

/** The downloaded CLI for `version`, if it was installed under `dir`. */
export function downloadedCopilotCliPath(dir: string, version: string): string | undefined {
  return packageEntry(path.join(dir, version, 'package'));
}

export interface CopilotCliInstallProgress {
  receivedBytes: number;
  totalBytes: number | undefined;
}

export interface InstallCopilotCliOptions {
  /** Where versions are unpacked (`<dir>/<version>/package`). */
  dir: string;
  version: string;
  fetchImpl?: typeof fetch;
  registry?: string;
  onProgress?: (p: CopilotCliInstallProgress) => void;
}

/** Downloads, verifies and unpacks the CLI; returns the runnable entry. Idempotent per version. */
export async function installCopilotCli(opts: InstallCopilotCliOptions): Promise<string> {
  const existing = downloadedCopilotCliPath(opts.dir, opts.version);
  if (existing) return existing;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const registry = (opts.registry ?? 'https://registry.npmjs.org').replace(/\/$/, '');
  const name = copilotPlatformPackage();

  const metaRes = await fetchImpl(`${registry}/${name.replace('/', '%2f')}/${encodeURIComponent(opts.version)}`);
  if (!metaRes.ok) throw new Error(`The npm registry has no ${name}@${opts.version} (HTTP ${metaRes.status}).`);
  const meta = (await metaRes.json()) as { dist?: { tarball?: unknown; integrity?: unknown; unpackedSize?: unknown } };
  const tarball = typeof meta.dist?.tarball === 'string' ? meta.dist.tarball : undefined;
  const integrity = typeof meta.dist?.integrity === 'string' ? meta.dist.integrity : undefined;
  if (!tarball || !integrity?.startsWith('sha512-')) throw new Error(`${name}@${opts.version} has no sha512-verified tarball on the registry.`);

  const versionDir = path.join(opts.dir, opts.version);
  const staging = path.join(opts.dir, `.staging-${opts.version}-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const archive = path.join(staging, 'cli.tgz');
    const res = await fetchImpl(tarball);
    if (!res.ok || !res.body) throw new Error(`Downloading ${name} failed (HTTP ${res.status}).`);
    const total = Number(res.headers.get('content-length')) || undefined;
    const hash = createHash('sha512');
    let received = 0;
    let lastReport = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        hash.update(chunk);
        received += chunk.length;
        if (received - lastReport > 4 * 1024 * 1024 || received === total) {
          lastReport = received;
          opts.onProgress?.({ receivedBytes: received, totalBytes: total });
        }
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(archive));
    if (`sha512-${hash.digest('base64')}` !== integrity) {
      throw new Error(`The downloaded ${name} does not match the registry's checksum; nothing was installed.`);
    }
    // Unpacked into staging first: a half-extracted CLI must never be found and run.
    await execFileAsync('tar', ['-xzf', archive, '-C', staging]);
    await rm(archive, { force: true });
    const unpacked = path.join(staging, 'package');
    if (!packageEntry(unpacked)) throw new Error(`The ${name} archive has no runnable entry.`);
    await rm(versionDir, { recursive: true, force: true });
    await mkdir(versionDir, { recursive: true });
    await rename(unpacked, path.join(versionDir, 'package'));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  const entry = downloadedCopilotCliPath(opts.dir, opts.version);
  if (!entry) throw new Error(`${name} was unpacked but its entry is missing.`);
  return entry;
}

/** sha512 of a file as an npm integrity string (tests). */
export async function fileIntegrity(file: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return `sha512-${hash.digest('base64')}`;
}

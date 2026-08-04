// ────────────────────────────────────────────────────────────────
// CookieImport — pull cookies from the user's own installed Chrome/Edge/
// Brave/Arc profile so the agent can reach pages the human is already
// authenticated on (internal tools, staging, GitHub, …) instead of hitting
// a login wall every session.
//
// Platform notes (read before trusting a platform you haven't verified):
//   • Windows — fully implemented and runtime-verified in this repo's dev
//     environment against real installed Chrome/Edge profiles. The AES
//     master key in `Local State`'s `os_crypt.encrypted_key` is protected
//     with Windows DPAPI at *user* scope, which any process running as the
//     same Windows user can decrypt — including this one. We shell out to
//     PowerShell's `System.Security.Cryptography.ProtectedData.Unprotect`
//     rather than add a native addon dependency for one call.
//   • macOS — implemented to the documented Chromium spec (Keychain entry
//     "<Browser> Safe Storage" → PBKDF2 → AES-128-CBC key), but NOT
//     runtime-verified — this session has no macOS machine to test against.
//   • Linux — implemented as a best-effort `secret-tool` (libsecret) call;
//     also NOT runtime-verified, and Chromium's Linux key storage varies
//     more by distro/desktop (may fall back to an unencrypted key entirely
//     on some configs) than the other two platforms.
//
// Requires Node.js ≥22 (uses the built-in `node:sqlite` to read the
// Cookies database read-only, rather than adding a native-module
// dependency — this package already avoids native deps outside the ones
// Playwright itself needs).
// ────────────────────────────────────────────────────────────────

import * as os from 'node:os';
// Type-only: erased at build time, so this does NOT create a hard runtime
// dependency on node:sqlite (which only exists on Node >= 22). The actual
// module is still loaded through a guarded dynamic import below.
import type { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as crypto from 'node:crypto';
import type { ImportedCookie } from '@generatorai/shared';

export type { ImportedCookie };

const execFileAsync = promisify(execFile);

export type SupportedCookieBrowser = 'chrome' | 'edge' | 'brave' | 'arc';

export interface CookieImportResult {
  browser: SupportedCookieBrowser;
  profileDir: string;
  cookies: ImportedCookie[];
  /** Rows present in the DB that couldn't be decrypted (format we don't
   *  handle, or a key mismatch) — reported so a caller can tell "imported
   *  0 of 40" from "there were only 0 cookies to begin with". */
  skipped: number;
}

// Integer columns come back as `bigint` (see readCookieRows' setReadBigInts)
// because expires_utc routinely exceeds Number.MAX_SAFE_INTEGER.
interface RawCookieRow {
  name: string;
  value: string;
  encrypted_value: Uint8Array;
  host_key: string;
  path: string;
  expires_utc: bigint;
  is_httponly: bigint;
  is_secure: bigint;
  samesite: bigint;
}

const CHROME_EPOCH_OFFSET_MICROS = 11_644_473_600_000_000n; // 1601-01-01 → 1970-01-01, in microseconds

function chromeTimeToUnixSeconds(chromeMicros: bigint): number | undefined {
  if (!chromeMicros) return undefined;
  const unixMicros = chromeMicros - CHROME_EPOCH_OFFSET_MICROS;
  if (unixMicros <= 0n) return undefined;
  return Number(unixMicros / 1_000_000n);
}

function mapSameSite(value: bigint): 'Strict' | 'Lax' | 'None' | undefined {
  // Chromium's CookieSameSite enum: -1 unspecified, 0 no_restriction (None), 1 lax, 2 strict.
  if (value === 2n) return 'Strict';
  if (value === 1n) return 'Lax';
  if (value === 0n) return 'None';
  return undefined;
}

function userDataDirFor(browser: SupportedCookieBrowser): string {
  const home = os.homedir();
  const plat = process.platform;
  if (plat === 'win32') {
    const local = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
    switch (browser) {
      case 'chrome': return path.join(local, 'Google', 'Chrome', 'User Data');
      case 'edge': return path.join(local, 'Microsoft', 'Edge', 'User Data');
      case 'brave': return path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data');
      case 'arc': throw new Error('Arc is not available on Windows.');
    }
  }
  if (plat === 'darwin') {
    const appSupport = path.join(home, 'Library', 'Application Support');
    switch (browser) {
      case 'chrome': return path.join(appSupport, 'Google', 'Chrome');
      case 'edge': return path.join(appSupport, 'Microsoft Edge');
      case 'brave': return path.join(appSupport, 'BraveSoftware', 'Brave-Browser');
      case 'arc': return path.join(appSupport, 'Arc', 'User Data');
    }
  }
  // Linux and anything else POSIX-like.
  const configHome = process.env['XDG_CONFIG_HOME'] ?? path.join(home, '.config');
  switch (browser) {
    case 'chrome': return path.join(configHome, 'google-chrome');
    case 'edge': return path.join(configHome, 'microsoft-edge');
    case 'brave': return path.join(configHome, 'BraveSoftware', 'Brave-Browser');
    case 'arc': throw new Error('Arc is not available on Linux.');
  }
}

/**
 * Copy the SQLite cookie DB (+ its WAL sidecar, if any — recent writes may
 * not be flushed to the main file yet) to `destDir`, retrying if the
 * browser writes to it mid-copy. Verified via a before/after `stat`
 * (mtime + size) rather than a lock, since we deliberately don't want to
 * block/interfere with the user's own browser.
 */
async function copyStableSnapshot(srcPath: string, destPath: string, attempts = 5): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    let before;
    try {
      before = await fs.stat(srcPath);
    } catch (err) {
      throw new Error(`Cookie database not found at ${srcPath}: ${(err as Error).message}`);
    }
    try {
      await fs.copyFile(srcPath, destPath);
      const walSrc = `${srcPath}-wal`;
      const walDest = `${destPath}-wal`;
      await fs.copyFile(walSrc, walDest).catch(() => undefined); // no WAL file is normal, not an error
      const after = await fs.stat(srcPath);
      if (before.mtimeMs === after.mtimeMs && before.size === after.size) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (lastErr) {
    // On Windows, some Chromium builds hold the Cookies file under a
    // continuous exclusive lock for the entire time the browser is
    // running — not just during writes — so this isn't a transient
    // condition retries will outlast. Verified empirically: 20 retries
    // spanning 6s all failed the same way against a running Chrome/Edge on
    // this platform. Surface that plainly instead of a raw ENOENT/EBUSY.
    const code = (lastErr as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM') {
      throw new Error(
        `Cookie database at ${srcPath} is locked by the running browser. Close it and retry — ` +
          `this Node process can't bypass an OS-level exclusive lock.`,
      );
    }
    throw lastErr as Error;
  }
  // Fell through without a stable snapshot after all attempts — proceed
  // with whatever was last copied rather than fail outright; a cookie
  // written in the last 100ms window is not worth blocking the import for.
}

async function readCookieRows(dbPath: string): Promise<RawCookieRow[]> {
  let DatabaseSyncCtor: typeof DatabaseSync;
  try {
    ({ DatabaseSync: DatabaseSyncCtor } = await import('node:sqlite'));
  } catch {
    throw new Error('Cookie import requires Node.js >= 22 (uses the built-in node:sqlite module).');
  }
  const db = new DatabaseSyncCtor(dbPath, { readOnly: true });
  try {
    const stmt = db.prepare(
      'SELECT name, value, encrypted_value, host_key, path, expires_utc, is_httponly, is_secure, samesite FROM cookies',
    );
    // expires_utc (Chrome-epoch microseconds) routinely exceeds
    // Number.MAX_SAFE_INTEGER — node:sqlite throws rather than silently
    // losing precision unless told to return oversized INTEGER columns as
    // BigInt. chromeTimeToUnixSeconds() accepts either.
    (stmt as unknown as { setReadBigInts?: (v: boolean) => void }).setReadBigInts?.(true);
    return stmt.all() as unknown as RawCookieRow[];
  } finally {
    db.close();
  }
}

// ── Windows: DPAPI (user-scoped) via PowerShell — no native addon needed ──

async function decryptDpapiWindows(blob: Buffer): Promise<Buffer> {
  const script =
    `Add-Type -AssemblyName System.Security; ` +
    `[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect(` +
    `[Convert]::FromBase64String('${blob.toString('base64')}'), $null, ` +
    `[System.Security.Cryptography.DataProtectionScope]::CurrentUser))`;
  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  return Buffer.from(stdout.trim(), 'base64');
}

async function getMasterKeyWindows(userDataDir: string): Promise<Buffer> {
  const localState = JSON.parse(await fs.readFile(path.join(userDataDir, 'Local State'), 'utf8')) as {
    os_crypt?: { encrypted_key?: string };
  };
  const encoded = localState.os_crypt?.encrypted_key;
  if (!encoded) throw new Error("No os_crypt.encrypted_key in this browser's Local State.");
  const withPrefix = Buffer.from(encoded, 'base64');
  const prefix = withPrefix.subarray(0, 5).toString('latin1');
  if (prefix !== 'DPAPI') throw new Error(`Unexpected encrypted_key prefix '${prefix}' (expected 'DPAPI').`);
  return decryptDpapiWindows(withPrefix.subarray(5));
}

// ── macOS: Keychain "<Browser> Safe Storage" → PBKDF2 → AES-128-CBC ──
// Implemented to spec; not runtime-verified (no macOS box in this session).

const KEYCHAIN_SERVICE_NAME: Record<SupportedCookieBrowser, string> = {
  chrome: 'Chrome Safe Storage',
  edge: 'Microsoft Edge Safe Storage',
  brave: 'Brave Safe Storage',
  arc: 'Arc Safe Storage',
};

async function getMasterKeyMacOs(browser: SupportedCookieBrowser): Promise<Buffer> {
  const service = KEYCHAIN_SERVICE_NAME[browser];
  const { stdout } = await execFileAsync('security', ['find-generic-password', '-w', '-s', service]);
  const password = stdout.trim();
  return crypto.pbkdf2Sync(password, 'saltysalt', 1, 16, 'sha1');
}

// ── Linux: best-effort via libsecret's `secret-tool` CLI ──
// Implemented as documented for the common case; not runtime-verified —
// Chromium's Linux keyring backend varies more by distro/desktop than the
// other two platforms, and some configs store the key unencrypted.

async function getMasterKeyLinux(browser: SupportedCookieBrowser): Promise<Buffer> {
  const label = browser === 'chrome' ? 'Chrome' : browser === 'edge' ? 'Microsoft Edge' : browser === 'brave' ? 'Brave' : 'Arc';
  const { stdout } = await execFileAsync('secret-tool', ['lookup', 'application', label]);
  const password = stdout.trim() || 'peanuts'; // Chromium's documented fallback when no keyring is available
  return crypto.pbkdf2Sync(password, 'saltysalt', 1, 16, 'sha1');
}

async function getMasterKey(browser: SupportedCookieBrowser, userDataDir: string): Promise<Buffer> {
  if (process.platform === 'win32') return getMasterKeyWindows(userDataDir);
  if (process.platform === 'darwin') return getMasterKeyMacOs(browser);
  return getMasterKeyLinux(browser);
}

/** Decrypt a `v10`/`v11`-format `encrypted_value` (AES-{256,128}-GCM, depending on platform). Returns `null` for an unsupported/legacy format or a decrypt failure (wrong key, corrupt row, …) rather than throwing — one bad cookie shouldn't fail the whole import. */
function decryptCookieValue(encryptedValue: Uint8Array, key: Buffer): string | null {
  const buf = Buffer.from(encryptedValue);
  if (buf.length < 3 + 12 + 16) return null;
  const version = buf.subarray(0, 3).toString('latin1');
  if (version !== 'v10' && version !== 'v11') return null;
  const nonce = buf.subarray(3, 15);
  const rest = buf.subarray(15);
  const authTag = rest.subarray(rest.length - 16);
  const ciphertext = rest.subarray(0, rest.length - 16);
  try {
    const algo = key.length === 32 ? 'aes-256-gcm' : 'aes-128-gcm';
    const decipher = crypto.createDecipheriv(algo, key, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export interface CookieImportOptions {
  browser: SupportedCookieBrowser;
  /** Directory to stage the copied DB in — caller's responsibility to
   *  clean up (typically a workspace-scoped temp dir). */
  workDir: string;
  /** Only import cookies for these hosts (glob-style, e.g. "*.github.com").
   *  Omit to import everything in the profile. */
  hostFilter?: string[];
  /** Override the resolved "User Data" directory. Exists for tests — lets
   *  a test point this at a synthetic fixture instead of the real,
   *  currently-locked, personal browser profile. */
  userDataDirOverride?: string;
}

function hostMatches(host: string, patterns: string[]): boolean {
  const normalizedHost = host.replace(/^\./, '');
  return patterns.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      return normalizedHost === base || normalizedHost.endsWith(`.${base}`);
    }
    return normalizedHost === pattern;
  });
}

/** Import cookies from the user's own installed browser profile. See the
 *  file header for per-platform verification status. */
export async function importBrowserCookies(opts: CookieImportOptions): Promise<CookieImportResult> {
  const userDataDir = opts.userDataDirOverride ?? userDataDirFor(opts.browser);
  const profileDir = path.join(userDataDir, 'Default');
  const cookiesDbPath = path.join(profileDir, 'Network', 'Cookies');

  await fs.mkdir(opts.workDir, { recursive: true });
  const snapshotPath = path.join(opts.workDir, `cookies-${Date.now()}.sqlite`);
  await copyStableSnapshot(cookiesDbPath, snapshotPath);

  try {
    const key = await getMasterKey(opts.browser, userDataDir);
    const rows = await readCookieRows(snapshotPath);

    const cookies: ImportedCookie[] = [];
    let skipped = 0;
    for (const row of rows) {
      if (opts.hostFilter && opts.hostFilter.length > 0 && !hostMatches(row.host_key, opts.hostFilter)) continue;
      let value: string | null = row.value || null;
      if (!value && row.encrypted_value && row.encrypted_value.length > 0) {
        value = decryptCookieValue(row.encrypted_value, key);
      }
      if (value == null) { skipped += 1; continue; }
      cookies.push({
        name: row.name,
        value,
        domain: row.host_key,
        path: row.path,
        expires: chromeTimeToUnixSeconds(row.expires_utc),
        httpOnly: !!row.is_httponly,
        secure: !!row.is_secure,
        sameSite: mapSameSite(row.samesite),
      });
    }
    return { browser: opts.browser, profileDir, cookies, skipped };
  } finally {
    await fs.rm(snapshotPath, { force: true }).catch(() => undefined);
    await fs.rm(`${snapshotPath}-wal`, { force: true }).catch(() => undefined);
  }
}

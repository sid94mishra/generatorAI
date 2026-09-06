// ────────────────────────────────────────────────────────────────
// KeyProvider — supplies the key-encryption key (KEK) for the
// encrypted-file secret backend.
//
// The KEK never lives in the vault file. Where it comes from determines
// whether the deployment is considered `secure`:
//
//   OS keychain / DPAPI (desktop, via Electron safeStorage) → secure
//   Operator-supplied env/KMS key                           → secure
//   Operator passphrase (scrypt-derived)                    → secure
//   Local key file with 0600 perms                          → NOT secure
// ────────────────────────────────────────────────────────────────

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface KeyProviderInfo {
  kind: string;
  secure: boolean;
  reason?: string;
  location?: string;
}

export interface KeyProvider {
  /** Returns exactly 32 bytes. Throws when the backend is unavailable. */
  getKey(): Promise<Buffer>;
  /** Discards the current key and produces a fresh one (for rotation). */
  rotateKey?(): Promise<Buffer>;
  /**
   * Keys that used to protect the vault and should still be accepted once, so
   * an operator changing the KEK migrates instead of losing every secret.
   *
   * Only providers where the OPERATOR owns the key need this. The OS- and
   * file-backed providers rotate in place via `rotateKey`, so they never see a
   * key they cannot reproduce; an env-supplied key can change between two
   * process starts with nothing on disk connecting the two.
   */
  previousKeys?(): Promise<Buffer[]>;
  info(): KeyProviderInfo;
}

const KEY_BYTES = 32;

/**
 * KEK supplied out-of-band by the operator.
 *
 * `GENERATORAI_SECRET_KEY`          — base64 or hex encoded 32-byte key.
 * `GENERATORAI_SECRET_PASSPHRASE`   — passphrase, stretched with scrypt using a
 *                                     salt persisted next to the vault.
 * `GENERATORAI_SECRET_KEY_PREVIOUS` — comma-separated older keys, accepted only
 *                                     to re-encrypt the vault under the current
 *                                     one. Remove it after the server logs that
 *                                     the migration completed.
 */
export class EnvKeyProvider implements KeyProvider {
  private cached: Buffer | null = null;

  constructor(private readonly saltPath: string) {}

  static isConfigured(): boolean {
    return Boolean(
      process.env['GENERATORAI_SECRET_KEY'] ?? process.env['GENERATORAI_SECRET_PASSPHRASE'],
    );
  }

  async getKey(): Promise<Buffer> {
    if (this.cached) return this.cached;

    const raw = process.env['GENERATORAI_SECRET_KEY'];
    if (raw) {
      const decoded = decodeKeyMaterial(raw);
      if (decoded.length !== KEY_BYTES) {
        throw new Error(
          `GENERATORAI_SECRET_KEY must decode to ${KEY_BYTES} bytes (got ${decoded.length}).`,
        );
      }
      this.cached = decoded;
      return decoded;
    }

    const passphrase = process.env['GENERATORAI_SECRET_PASSPHRASE'];
    if (!passphrase) {
      throw new Error('EnvKeyProvider requires GENERATORAI_SECRET_KEY or GENERATORAI_SECRET_PASSPHRASE');
    }
    const salt = readOrCreateSalt(this.saltPath);
    // scrypt with the interactive-login parameters recommended by RFC 7914.
    const key = crypto.scryptSync(passphrase, salt, KEY_BYTES, {
      N: 1 << 15,
      r: 8,
      p: 1,
      maxmem: 128 * (1 << 15) * 8 * 2,
    });
    this.cached = key;
    return key;
  }

  info(): KeyProviderInfo {
    return {
      kind: process.env['GENERATORAI_SECRET_KEY'] ? 'env-key' : 'env-passphrase',
      secure: true,
    };
  }

  /**
   * Superseded keys from `GENERATORAI_SECRET_KEY_PREVIOUS`.
   *
   * Malformed entries are skipped rather than thrown: this list exists to
   * RECOVER a vault, so one bad value must not block a good one beside it.
   */
  async previousKeys(): Promise<Buffer[]> {
    const raw = process.env['GENERATORAI_SECRET_KEY_PREVIOUS'];
    if (!raw) return [];
    const keys: Buffer[] = [];
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        const decoded = decodeKeyMaterial(trimmed);
        if (decoded.length === KEY_BYTES) keys.push(decoded);
      } catch {
        // Not usable key material; the next candidate may still be.
      }
    }
    return keys;
  }
}

/**
 * KEK unwrapped by a host-supplied callback — used by the Electron desktop
 * shell, which owns `safeStorage` (macOS Keychain / Windows DPAPI / libsecret).
 *
 * The desktop main process passes down `{ encrypt, decrypt, backendKind }`
 * so this package never imports Electron.
 */
export interface OsProtectedKeyHooks {
  /** Backend identifier reported by the host (`keychain`, `dpapi`, `libsecret`, …). */
  backendKind: string;
  /** True when the host verified the OS backend is genuinely encrypting. */
  secure: boolean;
  /** Reason when `secure` is false. */
  reason?: string;
  encrypt(plain: Buffer): Buffer;
  decrypt(cipher: Buffer): Buffer;
}

export class OsProtectedKeyProvider implements KeyProvider {
  private cached: Buffer | null = null;

  constructor(
    private readonly hooks: OsProtectedKeyHooks,
    private readonly wrappedKeyPath: string,
  ) {}

  async getKey(): Promise<Buffer> {
    if (this.cached) return this.cached;
    if (!this.hooks.secure) {
      throw new Error(
        `OS secret backend "${this.hooks.backendKind}" is not encrypting ` +
          `(${this.hooks.reason ?? 'unknown reason'}). Refusing to persist secrets. ` +
          'Set GENERATORAI_SECRET_KEY or GENERATORAI_SECRET_PASSPHRASE instead.',
      );
    }
    if (fs.existsSync(this.wrappedKeyPath)) {
      const wrapped = fs.readFileSync(this.wrappedKeyPath);
      const key = this.hooks.decrypt(wrapped);
      if (key.length !== KEY_BYTES) {
        throw new Error('Stored key-encryption key has an unexpected length — vault may be corrupt.');
      }
      this.cached = key;
      return key;
    }
    return this.writeFreshKey();
  }

  async rotateKey(): Promise<Buffer> {
    this.cached = null;
    return this.writeFreshKey();
  }

  private writeFreshKey(): Buffer {
    const key = crypto.randomBytes(KEY_BYTES);
    fs.mkdirSync(path.dirname(this.wrappedKeyPath), { recursive: true });
    writeFileAtomicRestricted(this.wrappedKeyPath, this.hooks.encrypt(key));
    this.cached = key;
    return key;
  }

  info(): KeyProviderInfo {
    return {
      kind: `os-${this.hooks.backendKind}`,
      secure: this.hooks.secure,
      ...(this.hooks.reason ? { reason: this.hooks.reason } : {}),
      location: this.wrappedKeyPath,
    };
  }
}

/**
 * Last-resort KEK stored in a mode-0600 file next to the vault.
 *
 * This protects against *other OS users* and against casual disclosure of the
 * vault file, but not against another process running as the same user. It is
 * reported as `secure: false` so `/api/security/status` and the desktop
 * diagnostics surface can warn, and so production/non-loopback startup can
 * refuse it (see `requireSecureBackend`).
 */
export class LocalFileKeyProvider implements KeyProvider {
  private cached: Buffer | null = null;

  constructor(private readonly keyPath: string) {}

  async getKey(): Promise<Buffer> {
    if (this.cached) return this.cached;
    if (fs.existsSync(this.keyPath)) {
      const key = fs.readFileSync(this.keyPath);
      if (key.length !== KEY_BYTES) {
        // A key file of the wrong length is ALWAYS an error — a crash mid-write,
        // an interrupted copy, a partial restore. This used to fall through to
        // `rotateKey()`, which generated a fresh key and overwrote the file, so
        // every secret in the vault became permanently unreadable with no error
        // (APPLICATION-REVIEW 5.11). Mirrors `OsProtectedKeyProvider`, which has
        // always refused here. `__tests__/KeyProvider.test.ts` pins that the
        // file is left untouched.
        throw new Error(
          `Key file ${this.keyPath} has an unexpected length (${key.length} bytes, expected ${KEY_BYTES}) — ` +
            'refusing to re-key. Restore the file from backup, or delete it deliberately to start a new ' +
            'vault (every existing secret becomes unreadable).',
        );
      }
      this.cached = key;
      return key;
    }
    return this.writeFreshKey();
  }

  /**
   * Explicit rotation only — never reached implicitly from `getKey()`.
   * Overwrites the key file; the caller (`EncryptedFileSecretStore`) is
   * responsible for re-encrypting the vault under the new key.
   */
  async rotateKey(): Promise<Buffer> {
    this.cached = null;
    return this.writeFreshKey();
  }

  private writeFreshKey(): Buffer {
    const key = crypto.randomBytes(KEY_BYTES);
    fs.mkdirSync(path.dirname(this.keyPath), { recursive: true });
    writeFileAtomicRestricted(this.keyPath, key);
    this.cached = key;
    return key;
  }

  info(): KeyProviderInfo {
    return {
      kind: 'local-file-key',
      secure: false,
      reason:
        'Key-encryption key is stored in a mode-0600 file. Any process running as this OS ' +
        'user can read it. Set GENERATORAI_SECRET_KEY / GENERATORAI_SECRET_PASSPHRASE, or run ' +
        'inside the desktop shell, to use an OS-protected key.',
      location: this.keyPath,
    };
  }
}

/** In-memory KEK — tests only. Never persists. */
export class EphemeralKeyProvider implements KeyProvider {
  private readonly key = crypto.randomBytes(KEY_BYTES);
  async getKey(): Promise<Buffer> {
    return this.key;
  }
  info(): KeyProviderInfo {
    return { kind: 'ephemeral', secure: false, reason: 'In-memory key — not persisted.' };
  }
}

function decodeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  return Buffer.from(trimmed, 'base64');
}

function readOrCreateSalt(saltPath: string): Buffer {
  if (fs.existsSync(saltPath)) {
    const salt = fs.readFileSync(saltPath);
    if (salt.length >= 16) return salt;
  }
  const salt = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(saltPath), { recursive: true });
  writeFileAtomicRestricted(saltPath, salt);
  return salt;
}

/**
 * `fs.renameSync` with a short retry, for Windows' transient EPERM/EBUSY.
 *
 * Deliberately synchronous and bounded: this sits on the boot path, so it must
 * not become a place the process can hang. A failure that outlives the budget
 * is a real one and is rethrown with the original cause.
 */
export function renameWithRetry(
  from: string,
  to: string,
  attempts = 10,
  delayMs = 30,
  /** Injectable purely so the retry can be tested; ESM exports cannot be spied on. */
  rename: (a: string, b: string) => void = fs.renameSync,
): void {
  for (let i = 0; ; i += 1) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (transient && i >= attempts - 1) {
        // Not transient after all: something holds the DESTINATION open for as
        // long as it likes. A file-syncing client (OneDrive — and this repo
        // lives under a synced Desktop) or an endpoint scanner both do this,
        // and a rename can never replace a directory entry whose target is
        // held. Observed for real: months of orphaned `.tmp` files next to the
        // vault, and a FATAL boot failure every time the server restarted.
        //
        // Copy the bytes into the existing file instead. That gives up the
        // rename's atomicity — a crash mid-copy can leave a short file — which
        // is why it is the fallback and not the path: the alternative here is
        // not "atomic write", it is "the server does not start".
        try {
          fs.copyFileSync(from, to);
          try {
            fs.unlinkSync(from);
          } catch {
            /* best effort */
          }
          return;
        } catch {
          // Fall through and report the original rename failure.
        }
      }
      if (!transient || i >= attempts - 1) {
        // Leave no stray temp file behind on a genuine failure.
        try {
          fs.unlinkSync(from);
        } catch {
          /* best effort */
        }
        throw err;
      }
      // Busy-wait: there is no synchronous sleep, and the window is milliseconds.
      const until = Date.now() + delayMs;
      while (Date.now() < until) {
        /* spin briefly */
      }
    }
  }
}

/**
 * Atomic, permission-restricted write: temp file in the same directory →
 * fsync → rename → fsync(dir). `mode: 0o600` is applied at creation time so
 * there is never a window where the file is world-readable.
 *
 * On Windows the mode bits are ignored by the OS; inherited ACLs from the
 * per-user AppData/userData directory provide the equivalent protection.
 */
export function writeFileAtomicRestricted(filePath: string, data: Buffer | string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    /* Windows / unsupported FS */
  }
  // Windows fails an otherwise-valid rename with EPERM/EBUSY whenever anything
  // else holds the destination open for even a moment — a virus scanner, the
  // search indexer, or the previous server process on a fast restart. It is
  // transient, and it was FATAL here: a dev-server restart killed the whole
  // process with `EPERM: operation not permitted, rename …secrets.vault.json`
  // before it finished booting. Retry briefly, then report honestly.
  renameWithRetry(tmp, filePath);
  try {
    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Directory fsync is not supported on Windows; the rename is still atomic.
  }
}

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
  info(): KeyProviderInfo;
}

const KEY_BYTES = 32;

/**
 * KEK supplied out-of-band by the operator.
 *
 * `GENERATORAI_SECRET_KEY`        — base64 or hex encoded 32-byte key.
 * `GENERATORAI_SECRET_PASSPHRASE` — passphrase, stretched with scrypt using a
 *                                   salt persisted next to the vault.
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
      if (key.length === KEY_BYTES) {
        this.cached = key;
        return key;
      }
    }
    return this.rotateKey();
  }

  async rotateKey(): Promise<Buffer> {
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
  fs.renameSync(tmp, filePath);
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

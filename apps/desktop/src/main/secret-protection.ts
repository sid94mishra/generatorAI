// ────────────────────────────────────────────────────────────────
// Desktop secret protection — the OS-backed key that guards the vault.
//
// The GeneratorAI server runs as a SEPARATE process, so it cannot call
// Electron's `safeStorage` itself. Instead the desktop shell owns the key
// encryption key (KEK):
//
//   1. Generate 32 random bytes once.
//   2. Encrypt them with `safeStorage` (Keychain / DPAPI / libsecret).
//   3. Store the ciphertext in `userData/secret-key.bin` (0600).
//   4. Hand the *plaintext* KEK to the server through an env var, which is
//      readable only by the same OS user and never touches disk.
//
// The server's `EncryptedFileSecretStore` then derives per-secret keys from
// that KEK. This is exactly the plan's "encrypted file with injected KEK"
// backend (§10.2, container/server row) but with an OS keystore providing the
// injection instead of a cloud KMS.
//
// Hard rule: if `safeStorage` reports an insecure backend (Linux
// `basic_text`), we refuse to persist the KEK rather than writing a key that
// is only obfuscated. The user is told to install a secret service.
// ────────────────────────────────────────────────────────────────

import { app, safeStorage } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from './logger.js';

const KEY_FILE = 'secret-key.bin';
const KEY_BYTES = 32;

export interface SecretProtectionResult {
  /** Base64 KEK to hand the server via `GENERATORAI_SECRET_KEY`. */
  key: string;
  /** Which OS backend protected it, for the security posture UI. */
  backend: string;
  secure: boolean;
  reason?: string;
}

function keyFilePath(): string {
  return path.join(app.getPath('userData'), KEY_FILE);
}

/**
 * On Linux, Electron may silently fall back to `basic_text`, which is
 * *obfuscation, not encryption*. Treat that as insecure.
 */
function describeBackend(): { backend: string; secure: boolean; reason?: string } {
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      backend: 'unavailable',
      secure: false,
      reason: 'The OS keystore is not available to this process.',
    };
  }
  if (process.platform === 'linux') {
    // `getSelectedStorageBackend` exists on Linux only.
    const selected = (safeStorage as unknown as {
      getSelectedStorageBackend?: () => string;
    }).getSelectedStorageBackend?.() ?? 'unknown';
    if (selected === 'basic_text') {
      return {
        backend: 'basic_text',
        secure: false,
        reason:
          'No secret service is running (gnome-keyring / kwallet). Electron would ' +
          'only obfuscate the key, not encrypt it.',
      };
    }
    return { backend: selected, secure: true };
  }
  return {
    backend: process.platform === 'darwin' ? 'keychain' : 'dpapi',
    secure: true,
  };
}

/**
 * Loads the KEK, creating and protecting it on first run.
 *
 * Returns `null` when the platform cannot protect it securely — the caller
 * then starts the server without an injected key, and the server falls back
 * to its own (weaker, but explicit and reported) file-based key derivation.
 */
export function loadOrCreateSecretKey(): SecretProtectionResult | null {
  const info = describeBackend();
  const file = keyFilePath();

  if (!info.secure) {
    log.warn('OS secret storage is not secure; the vault key will not be persisted here', {
      backend: info.backend,
      reason: info.reason,
    });
    return null;
  }

  // ── Existing key ───────────────────────────────────────────────
  if (fs.existsSync(file)) {
    try {
      const ciphertext = fs.readFileSync(file);
      const plaintext = safeStorage.decryptString(ciphertext);
      // Validate shape: a truncated/rewritten file must fail loudly rather
      // than silently producing a different vault key (which would look like
      // total credential loss).
      const raw = Buffer.from(plaintext, 'base64');
      if (raw.length !== KEY_BYTES) throw new Error('unexpected key length');
      return { key: plaintext, ...info };
    } catch (err) {
      // Decryption fails when the OS keystore entry was removed, the user
      // profile changed, or the file was corrupted. We must NOT silently
      // regenerate: that would orphan every stored credential. Rename the old
      // file so the user can recover it, then start fresh.
      const quarantine = `${file}.unreadable-${Date.now()}`;
      try {
        fs.renameSync(file, quarantine);
      } catch {
        /* best effort */
      }
      log.error(
        'Could not decrypt the stored vault key. Saved credentials will need to be re-entered.',
        { error: err instanceof Error ? err.message : String(err), quarantine },
      );
    }
  }

  // ── First run ──────────────────────────────────────────────────
  const key = crypto.randomBytes(KEY_BYTES).toString('base64');
  try {
    const ciphertext = safeStorage.encryptString(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, ciphertext, { mode: 0o600 });
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
    log.info('Created a new OS-protected vault key', { backend: info.backend });
  } catch (err) {
    log.error('Could not persist the vault key', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  return { key, ...info };
}

/**
 * Deletes the protected key. Only used by an explicit "reset credentials"
 * action — every stored secret becomes unrecoverable.
 */
export function destroySecretKey(): void {
  try {
    fs.rmSync(keyFilePath(), { force: true });
  } catch {
    /* best effort */
  }
}

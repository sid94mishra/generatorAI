// ────────────────────────────────────────────────────────────────
// createSecretStore — chooses the strongest available backend.
//
// Selection order:
//   1. Explicit operator key/passphrase   (GENERATORAI_SECRET_KEY / …PASSPHRASE)
//   2. OS-protected key hooks             (Electron desktop passes safeStorage)
//   3. Local mode-0600 key file           (secure: false — dev/loopback only)
//
// `requireSecure` makes the factory throw instead of silently degrading. The
// server enables it whenever it binds a non-loopback address or runs in
// production, which implements the plan's "refuse insecure silent fallback"
// rule (notably Linux `basic_text`).
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import {
  EnvKeyProvider,
  LocalFileKeyProvider,
  OsProtectedKeyProvider,
  type KeyProvider,
  type OsProtectedKeyHooks,
} from './KeyProvider.js';
import { EncryptedFileSecretStore } from './EncryptedFileSecretStore.js';
import { SecretStoreError, type SecretStore } from './SecretStore.js';

export interface CreateSecretStoreOptions {
  /** Directory that will hold `secrets.vault.json` and key material. */
  dataDir: string;
  /** Supplied by the Electron desktop shell; omitted for headless servers. */
  osHooks?: OsProtectedKeyHooks | undefined;
  /** Throw rather than fall back to a `secure: false` backend. */
  requireSecure?: boolean;
  logger?: { warn(msg: string, meta?: unknown): void; info(msg: string, meta?: unknown): void };
}

export function createSecretStore(options: CreateSecretStoreOptions): SecretStore {
  const dir = path.resolve(options.dataDir, 'secrets');
  const vaultPath = path.join(dir, 'secrets.vault.json');

  let keyProvider: KeyProvider;
  if (EnvKeyProvider.isConfigured()) {
    keyProvider = new EnvKeyProvider(path.join(dir, 'kdf.salt'));
  } else if (options.osHooks) {
    keyProvider = new OsProtectedKeyProvider(options.osHooks, path.join(dir, 'kek.enc'));
  } else {
    keyProvider = new LocalFileKeyProvider(path.join(dir, 'kek.key'));
  }

  const info = keyProvider.info();
  if (!info.secure) {
    const message =
      `Secret store backend "${info.kind}" is not OS-protected: ${info.reason ?? 'unknown reason'}`;
    if (options.requireSecure) {
      throw new SecretStoreError(
        `${message}\n` +
          'Refusing to start with an insecure secret backend. Provide GENERATORAI_SECRET_KEY ' +
          '(32 random bytes, base64 or hex) or GENERATORAI_SECRET_PASSPHRASE, or run inside ' +
          'the GeneratorAI desktop shell.',
        'INSECURE_BACKEND',
      );
    }
    options.logger?.warn(`[Secrets] ${message}`);
  } else {
    options.logger?.info(`[Secrets] Using secret backend "${info.kind}"`);
  }

  return new EncryptedFileSecretStore({ vaultPath, keyProvider });
}

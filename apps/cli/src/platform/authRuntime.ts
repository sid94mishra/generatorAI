// ────────────────────────────────────────────────────────────────
// CLI auth runtime — the terminal's paired device identity.
//
// The CLI is a first-class client, not a special case: it owns a device
// keypair, pairs with a pairing code, presents DPoP proofs, and is
// independently revocable from the device manager. The only difference from
// the browser is storage — Node cannot keep a non-extractable key alive
// across process restarts, so both the key and the session live in the
// OS-backed secret vault from `@generatorai/secrets`.
//
// Migration: `GENERATORAI_API_KEY` (env or `config.server.apiKey`) still
// works and simply bypasses DPoP. Every command warns once when it is used.
// ────────────────────────────────────────────────────────────────

import * as os from 'node:os';
import {
  AuthenticatedClientRuntime,
  SecretSinkDeviceKeyStore,
  SecretSinkSessionStore,
  parsePairingCode,
  type AuthState,
  type PairingConsent,
  type SecretSink,
} from '@generatorai/client-runtime';
import { createSecretStore, type SecretStore } from '@generatorai/secrets';
import { getUserConfigDir } from '../config/paths.js';

/** Namespace inside the vault that holds this CLI installation's identity. */
const CLI_NAMESPACE = 'cli';

/** Adapts the vault's byte API to the string sink the Node stores expect. */
class VaultSecretSink implements SecretSink {
  constructor(
    private readonly store: SecretStore,
    private readonly namespace: string,
  ) {}

  async get(name: string): Promise<string | null> {
    const value = await this.store.get(this.namespace, name);
    return value ? Buffer.from(value).toString('utf8') : null;
  }

  async set(name: string, value: string): Promise<void> {
    await this.store.set(this.namespace, name, Buffer.from(value, 'utf8'));
  }

  async remove(name: string): Promise<void> {
    await this.store.remove(this.namespace, name);
  }
}

export interface CliAuthOptions {
  /** Server the CLI should talk to, e.g. `http://127.0.0.1:3100`. */
  endpoint: string;
  /** Deprecated shared key from config/env. */
  legacyApiKey?: string | undefined;
  /** Isolates credentials per named profile so work/personal do not collide. */
  profile?: string | undefined;
}

let cached: { key: string; runtime: AuthenticatedClientRuntime } | null = null;
let warnedAboutLegacyKey = false;

function vaultDir(): string {
  // Same directory as the CLI config so `~/.generatorai` remains the single
  // place a user has to back up (or delete to fully sign out).
  return getUserConfigDir();
}

/**
 * Returns the process-wide runtime for `endpoint`.
 *
 * Cached per endpoint+profile: a single CLI invocation talks to one server,
 * and re-creating the runtime would re-read the vault (and re-refresh the
 * token) on every request.
 */
export function getCliAuthRuntime(options: CliAuthOptions): AuthenticatedClientRuntime {
  const endpoint = options.endpoint.replace(/\/$/, '');
  const cacheKey = `${endpoint}::${options.profile ?? 'default'}`;
  if (cached?.key === cacheKey) return cached.runtime;

  if (options.legacyApiKey && !warnedAboutLegacyKey) {
    warnedAboutLegacyKey = true;
    process.stderr.write(
      'warning: GENERATORAI_API_KEY is deprecated and grants full access to this server.\n' +
        '         Run `generatorai device pair <code>` to use a scoped, revocable credential.\n',
    );
  }

  const store = createSecretStore({
    dataDir: vaultDir(),
    // The CLI must keep working on a laptop without a secret service; the
    // encrypted-file backend still protects the key at rest with 0600 perms
    // and reports itself honestly in `device status`.
    requireSecure: false,
  });
  const namespace = options.profile ? `${CLI_NAMESPACE}/${options.profile}` : CLI_NAMESPACE;
  const sink = new VaultSecretSink(store, namespace);

  const runtime = new AuthenticatedClientRuntime({
    endpoint,
    keyStore: new SecretSinkDeviceKeyStore(sink),
    sessionStore: new SecretSinkSessionStore(sink),
    ...(options.legacyApiKey ? { legacyApiKey: options.legacyApiKey } : {}),
  });
  cached = { key: cacheKey, runtime };
  return runtime;
}

/** Describes the vault backend for `device status`. */
export async function describeCliSecretBackend(): Promise<{
  kind: string;
  secure: boolean;
  reason?: string | undefined;
}> {
  const store = createSecretStore({ dataDir: vaultDir(), requireSecure: false });
  const info = await store.backendInfo();
  return { kind: info.kind, secure: info.secure, reason: info.reason };
}

/** Default device name so `device list` is readable without extra typing. */
export function defaultCliDeviceName(): string {
  return `CLI on ${os.hostname()}`;
}

export function parseCliPairingCode(code: string): PairingConsent {
  return parsePairingCode(code.trim());
}

export { type AuthState, type PairingConsent };

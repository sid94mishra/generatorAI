// ────────────────────────────────────────────────────────────────
// The CLI's own device identity.
//
// The CLI is a first-class client, not a special case: it owns a device
// keypair, pairs with a pairing code, presents DPoP proofs, and is
// independently revocable from the device manager. The only difference from
// the browser is storage — Node cannot keep a non-extractable key alive
// across process restarts, so both the key and the session live in the
// OS-backed secret vault from `@generatorai/secrets`.
//
// Moved here from `apps/cli` so all three surfaces (binary, TUI, companion)
// authenticate through one path. The previous TUI bypassed this entirely and
// set `GENERATORAI_API_KEY` in the environment instead, which silently
// downgraded the interactive surface to the deprecated shared secret.
//
// Credentials are keyed by `serverId`, not by URL. A laptop that changes DHCP
// lease, or is reached over loopback at home and LAN from the sofa, is the
// SAME server and must keep the same credential.
// ────────────────────────────────────────────────────────────────

import * as os from 'node:os';
import {
  AuthenticatedClientRuntime,
  SecretSinkDeviceKeyStore,
  SecretSinkSessionStore,
  parsePairingCode,
  type AuthState,
  type SecretSink,
} from '@generatorai/client-runtime';
import { createSecretStore, type SecretStore } from '@generatorai/secrets';
import { getUserConfigDir } from '../config/paths.js';
import { CliError } from '../errors/CliError.js';

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
  /**
   * Host fingerprint. Credentials are namespaced by it so one installation
   * can hold several servers at once without them colliding.
   */
  serverId?: string | undefined;
  /** Deprecated shared key from config/env. */
  legacyApiKey?: string | undefined;
  /** Isolates credentials per named profile so work/personal do not collide. */
  profile?: string | undefined;
}

const runtimeCache = new Map<string, AuthenticatedClientRuntime>();
let warnedAboutLegacyKey = false;

function namespaceFor(options: CliAuthOptions): string {
  const parts = [CLI_NAMESPACE];
  if (options.profile) parts.push(options.profile);
  if (options.serverId) parts.push(options.serverId);
  return parts.join('/');
}

/**
 * Returns the process-wide runtime for a server.
 *
 * Cached per endpoint+profile+serverId: re-creating it would re-read the
 * vault and re-refresh the token on every request.
 */
export function getCliAuthRuntime(options: CliAuthOptions): AuthenticatedClientRuntime {
  const endpoint = options.endpoint.replace(/\/$/, '');
  const cacheKey = `${endpoint}::${options.profile ?? 'default'}::${options.serverId ?? '-'}`;
  const cached = runtimeCache.get(cacheKey);
  if (cached) return cached;

  if (options.legacyApiKey && !warnedAboutLegacyKey) {
    warnedAboutLegacyKey = true;
    process.stderr.write(
      'warning: GENERATORAI_API_KEY is deprecated and grants full access to this server.\n' +
        '         Run `generatorai device pair <code>` to use a scoped, revocable credential.\n',
    );
  }

  const store = createSecretStore({
    dataDir: getUserConfigDir(),
    // The CLI must keep working on a laptop without a secret service; the
    // encrypted-file backend still protects the key at rest with 0600 perms
    // and reports itself honestly in `device status`.
    requireSecure: false,
  });
  const sink = new VaultSecretSink(store, namespaceFor(options));

  const runtime = new AuthenticatedClientRuntime({
    endpoint,
    keyStore: new SecretSinkDeviceKeyStore(sink),
    sessionStore: new SecretSinkSessionStore(sink),
    ...(options.legacyApiKey ? { legacyApiKey: options.legacyApiKey } : {}),
  });
  runtimeCache.set(cacheKey, runtime);
  return runtime;
}

/** Clears the cache. Used when the active connection changes inside the TUI. */
export function resetCliAuthRuntimes(): void {
  runtimeCache.clear();
}

export async function describeCliSecretBackend(): Promise<{
  kind: string;
  secure: boolean;
  path?: string;
}> {
  const store = createSecretStore({ dataDir: getUserConfigDir(), requireSecure: false });
  const described = store as unknown as { describe?: () => { kind: string; secure: boolean; path?: string } };
  return (
    described.describe?.() ?? {
      kind: 'unknown',
      secure: false,
    }
  );
}

export function defaultCliDeviceName(): string {
  return `${os.hostname()} (cli)`;
}

/**
 * Parses a pairing code and turns a malformed one into a usable message.
 *
 * The shared parser throws a terse error; a user who mistyped one character
 * of a short code needs to be told that is what happened.
 */
export function parseCliPairingCode(code: string): ReturnType<typeof parsePairingCode> {
  try {
    return parsePairingCode(code.trim());
  } catch (error) {
    throw new CliError('VALIDATION', 'That does not look like a pairing code.', {
      hint: error instanceof Error ? error.message : String(error),
      suggestions: [
        'Generate one on the server with `generatorai device invite`',
        'Or copy it from Settings → Security → Pair a device in the web app',
      ],
    });
  }
}

export type { AuthState };

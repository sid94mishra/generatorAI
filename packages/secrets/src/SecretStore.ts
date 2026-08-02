// ────────────────────────────────────────────────────────────────
// SecretStore SPI — provider-neutral secret persistence contract
//
// Phase 1 of docs/SECURITY_AUTH_RELAY_MOBILE_ARCHITECTURE_PLAN.md.
//
// Nothing in the application persists a secret VALUE. Application records
// persist a `SecretRef` (namespace + name); the value only ever lives inside
// an implementation of this interface, which is responsible for choosing an
// OS-backed or explicitly-keyed encrypted backend.
// ────────────────────────────────────────────────────────────────

/**
 * Describes the backend actually in use at runtime so operators (and the
 * `/api/security/status` endpoint) can tell whether secrets are protected by
 * the OS, by an operator-supplied key, or by a weak fallback.
 */
export interface SecretBackendInfo {
  /** Stable identifier, e.g. `electron-safe-storage`, `encrypted-file`, `memory`. */
  kind: string;
  /**
   * True when the key-encryption key is protected by the OS keychain/DPAPI or
   * supplied out-of-band (KMS / env). False for best-effort local-file KEKs.
   */
  secure: boolean;
  /** Human-readable explanation, especially when `secure` is false. */
  reason?: string;
  /** Whether `rotate()` is meaningful for this backend. */
  supportsRotation: boolean;
  /** Where persisted material lives (path or platform store name). Never a secret. */
  location?: string;
}

/** A pointer to a secret. Safe to persist in the database and to log. */
export interface SecretRef {
  namespace: string;
  name: string;
}

/** `harness/claude-personal` + `oauth` → `harness/claude-personal/oauth` */
export function secretRefToString(ref: SecretRef): string {
  return `${ref.namespace}/${ref.name}`;
}

export function parseSecretRef(value: string): SecretRef | null {
  const idx = value.lastIndexOf('/');
  if (idx <= 0 || idx === value.length - 1) return null;
  return { namespace: value.slice(0, idx), name: value.slice(idx + 1) };
}

/**
 * Reserved namespaces. Keeping them centralized makes it possible to audit
 * "who can read what" and to scope credential injection per harness instance.
 */
export const SecretNamespace = {
  /** Server identity keypair, URL signing key, DB encryption keys. */
  system: 'system',
  /** Per-device resume credentials + relay bindings. */
  device: (deviceId: string) => `device/${deviceId}`,
  /** Per-harness-instance provider credentials (never shared across instances). */
  harness: (instanceId: string) => `harness/${instanceId}`,
  /** Source control / project management integrations. */
  integration: (provider: string, account: string) => `integration/${provider}/${account}`,
  /** Relay host keypair + relay control-plane credentials. */
  relay: 'relay',
  /** SSH private keys + known-hosts material. */
  ssh: (targetId: string) => `ssh/${targetId}`,
} as const;

export class SecretStoreError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'BACKEND_UNAVAILABLE'
      | 'INSECURE_BACKEND'
      | 'NOT_FOUND'
      | 'ALREADY_EXISTS'
      | 'INTEGRITY'
      | 'IO',
    options?: { cause?: unknown },
  ) {
    super(message, options as ErrorOptions);
    this.name = 'SecretStoreError';
  }
}

export interface SecretStore {
  /** Returns the raw secret bytes, or null when absent. */
  get(namespace: string, name: string): Promise<Uint8Array | null>;
  /** Creates or replaces the secret. */
  set(namespace: string, name: string, value: Uint8Array): Promise<void>;
  /** Creates the secret; throws `ALREADY_EXISTS` if it is already present. */
  create(namespace: string, name: string, value: Uint8Array): Promise<void>;
  /** Deletes the secret. No-op when absent. */
  remove(namespace: string, name: string): Promise<void>;
  /** Deletes every secret in a namespace (used by device/harness revocation). */
  removeNamespace(namespace: string): Promise<void>;
  /** Lists secret NAMES within a namespace. Never returns values. */
  list(namespace: string): Promise<string[]>;
  /** Atomically returns the existing secret or creates `bytes` random bytes. */
  getOrCreateRandom(namespace: string, name: string, bytes: number): Promise<Uint8Array>;
  /** Describes the backend in use. */
  backendInfo(): Promise<SecretBackendInfo>;
  /** Re-encrypts everything under a fresh key-encryption key, when supported. */
  rotate?(): Promise<void>;
  /** Flush + release handles. */
  close?(): Promise<void>;
}

/** Convenience helpers layered over the raw byte API. */
export async function getSecretString(
  store: SecretStore,
  namespace: string,
  name: string,
): Promise<string | null> {
  const bytes = await store.get(namespace, name);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

export async function setSecretString(
  store: SecretStore,
  namespace: string,
  name: string,
  value: string,
): Promise<void> {
  await store.set(namespace, name, new TextEncoder().encode(value));
}

export async function getSecretJson<T>(
  store: SecretStore,
  namespace: string,
  name: string,
): Promise<T | null> {
  const raw = await getSecretString(store, namespace, name);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new SecretStoreError(
      `Secret ${namespace}/${name} is not valid JSON`,
      'INTEGRITY',
      { cause: err },
    );
  }
}

export async function setSecretJson(
  store: SecretStore,
  namespace: string,
  name: string,
  value: unknown,
): Promise<void> {
  await setSecretString(store, namespace, name, JSON.stringify(value));
}

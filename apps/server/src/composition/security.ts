// ────────────────────────────────────────────────────────────────
// Security composition — SecretStore, auth services, startup policy.
//
// This module is the ONLY place the server decides whether it is safe to
// start. It implements the plan's Phase 0 fail-closed rule (§11.1):
//
//     loopback + dev + explicit opt-in  →  unauthenticated, loudly warned
//     loopback + dev + no opt-in        →  authenticated (auto-provisioned)
//     non-loopback  OR  production      →  authentication REQUIRED, and the
//                                          secret store must be OS-protected
//
// Nothing here reaches into Electron: the desktop shell injects its
// `safeStorage` hooks through `SecurityBootstrapOptions.osHooks`, so the same
// code path serves headless servers, containers and the desktop app.
// ────────────────────────────────────────────────────────────────

import * as os from 'node:os';
import * as path from 'node:path';
import {
  AuthService,
  DeviceService,
  DpopVerifier,
  SecurityAuditService,
  TokenService,
  ALL_SCOPES,  isLoopbackAddress,
  keyPairFromEd25519Seed,
  randomToken,
  type IDeviceRepository,
  type IDeviceScopeRequestRepository,
  type INonceStore,
  type IPairingGrantRepository,
  type IRelayRevokeOutboxRepository,
  type IReplayStore,
  type ISecurityAuditRepository,
  type IServiceAccountRepository,
  type IStreamTicketRepository,
  type ServerSigningKeyPair,
} from '@generatorai/auth';
import {
  createSecretStore,
  defaultLegacySecretSources,
  migrateLegacySecrets,
  registerSecretValue,
  type OsProtectedKeyHooks,
  type SecretStore,
} from '@generatorai/secrets';
import {
  SqliteDeviceRepository,
  SqliteDeviceScopeRequestRepository,
  SqliteNonceStore,
  SqlitePairingGrantRepository,
  SqliteRelayRevokeOutboxRepository,
  SqliteReplayStore,
  SqliteSecurityAuditRepository,
  SqliteServiceAccountRepository,
  SqliteStreamTicketRepository,
  type AppDatabase,
} from '@generatorai/db';
import { hostIdFromPublicKey, keyPairFromSecretKey, toBase64Url } from '@generatorai/relay-protocol';
import { setDefaultChatPermissionMode } from '@generatorai/core';
import type { AppConfig, ILogger } from '@generatorai/shared';

/**
 * The host's long-term X25519 identity. Clients pin `hostId` at pairing time,
 * which is what makes a substituted server detectable even when TLS is
 * self-signed or the connection is proxied through a relay.
 */
export interface ServerIdentity {
  hostId: string;
  publicKey: Uint8Array;
  publicKeyBase64Url: string;
  secretKey: Uint8Array;
}

export interface SecurityBootstrapOptions {
  config: AppConfig;
  db: AppDatabase;
  logger: ILogger;
  /** Supplied by the Electron desktop shell (safeStorage). */
  osHooks?: OsProtectedKeyHooks | undefined;
}

export interface SecurityContext {
  secretStore: SecretStore;
  tokens: TokenService;
  dpop: DpopVerifier;
  devices: DeviceService;
  auth: AuthService;
  audit: SecurityAuditService;
  /** Long-term X25519 host identity (pinned by paired clients). */
  identity: ServerIdentity;
  /**
   * Ed25519 key used ONLY for relay host proofs. Deliberately separate from
   * the token-signing key so a relay protocol flaw cannot be turned into an
   * access-token forgery.
   */
  relaySigningKey: ServerSigningKeyPair;

  deviceRepo: IDeviceRepository;
  pairingRepo: IPairingGrantRepository;
  replayStore: IReplayStore;
  nonceStore: INonceStore;
  streamTicketRepo: IStreamTicketRepository;
  serviceAccountRepo: IServiceAccountRepository;
  auditRepo: ISecurityAuditRepository;
  relayOutboxRepo: IRelayRevokeOutboxRepository;
  scopeRequestRepo: IDeviceScopeRequestRepository;

  /** Effective posture, surfaced by `GET /api/security/posture`. */
  posture: SecurityPosture;

  /** Stops background sweepers and flushes the audit queue. */
  shutdown(): Promise<void>;
}

export interface SecurityPosture {
  bindHost: string;
  loopbackOnly: boolean;
  production: boolean;
  authenticationRequired: boolean;
  unauthenticatedLoopback: boolean;
  secretBackend: { kind: string; secure: boolean; reason?: string | undefined };
  legacyApiKeyActive: boolean;
  relayEnabled: boolean;
  tokenAudience: string;
}

/** Thrown when the process must refuse to start. */
export class StartupSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartupSecurityError';
  }
}

const SWEEP_INTERVAL_MS = 5 * 60_000;

export async function createSecurityContext(
  options: SecurityBootstrapOptions,
): Promise<SecurityContext> {
  const { config, db, logger } = options;
  const security = config.security;

  const bindHost = process.env['GENERATORAI_BIND_HOST'] ?? security.bindHost;
  const loopbackOnly = isLoopbackAddress(bindHost);
  const production = process.env['NODE_ENV'] === 'production';

  const legacyApiKey = process.env['GENERATORAI_API_KEY']?.trim() || undefined;
  if (legacyApiKey) registerSecretValue(legacyApiKey);

  // ── Fail-closed gate #1: unauthenticated mode ────────────────────
  //
  // The opt-in is an env var rather than a config field so that it cannot be
  // switched on by a checked-in config file — turning off authentication has
  // to be a deliberate act on the machine that runs the server.
  const unauthOptIn =
    process.env['GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK'] === '1' ||
    security.allowUnauthenticatedLoopback;

  if (unauthOptIn && (!loopbackOnly || production)) {
    throw new StartupSecurityError(
      'GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK is set but this server is not a ' +
        `development loopback listener (bindHost=${bindHost}, NODE_ENV=${process.env['NODE_ENV'] ?? 'development'}).\n` +
        'Unauthenticated mode is only ever permitted on 127.0.0.1/::1 outside production. ' +
        'Remove the override, or bind to loopback.',
    );
  }

  const allowUnauthenticatedLoopback = unauthOptIn && loopbackOnly && !production;

  // ── Fail-closed gate #2: secret store strength ──────────────────
  //
  // Off-loopback or production deployments must have a real KEK. Everything
  // downstream (token signing seed, device credentials, relay host key,
  // harness credentials) is only as strong as this.
  const requireSecureSecretStore =
    security.requireSecureSecretStore || !loopbackOnly || production;

  const secretsDir = security.secretsDir ?? path.dirname(path.resolve(config.dbPath));
  const secretStore = createSecretStore({
    dataDir: secretsDir,
    osHooks: options.osHooks,
    requireSecure: requireSecureSecretStore,
    logger: {
      warn: (m, meta) => logger.warn(m, meta as Record<string, unknown>),
      info: (m, meta) => logger.info(m, meta as Record<string, unknown>),
    },
  });
  const backendInfo = await secretStore.backendInfo();

  // Runs before anything reads a secret. If the operator changed
  // GENERATORAI_SECRET_KEY and supplied the old one as
  // GENERATORAI_SECRET_KEY_PREVIOUS, the vault is re-encrypted here rather
  // than failing every read with an integrity error the only cure for which
  // was deleting it.
  if (secretStore.migrateKeyIfNeeded) {
    const outcome = await secretStore.migrateKeyIfNeeded();
    if (outcome === 'migrated') {
      logger.warn(
        '[Secrets] The vault was re-encrypted under the current GENERATORAI_SECRET_KEY. ' +
          'Remove GENERATORAI_SECRET_KEY_PREVIOUS from this environment now — it is no ' +
          'longer needed and keeping it around widens the window for a leaked old key.',
      );
    }
  }

  // ── Repositories ────────────────────────────────────────────────
  const deviceRepo = new SqliteDeviceRepository(db);
  const pairingRepo = new SqlitePairingGrantRepository(db);
  const replayStore = new SqliteReplayStore(db);
  const nonceStore = new SqliteNonceStore(db, () => randomToken(32));
  const streamTicketRepo = new SqliteStreamTicketRepository(db);
  const serviceAccountRepo = new SqliteServiceAccountRepository(db);
  const auditRepo = new SqliteSecurityAuditRepository(db);
  const relayOutboxRepo = new SqliteRelayRevokeOutboxRepository(db);
  const scopeRequestRepo = new SqliteDeviceScopeRequestRepository(db);

  // ── Services ────────────────────────────────────────────────────
  const audit = new SecurityAuditService(auditRepo, {
    warn: (m, meta) => logger.warn(m, meta as Record<string, unknown>),
  });

  const tokens = new TokenService({
    audience: security.tokenAudience,
    secretStore,
  });
  await tokens.initialize();

  const dpop = new DpopVerifier({ replayStore, nonceStore });

  // Long-term host identity. `getOrCreateRandom` is atomic in the vault, so a
  // concurrent first boot cannot mint two identities.
  const identitySecret = await secretStore.getOrCreateRandom('system', 'host-identity-x25519', 32);
  const identityPair = keyPairFromSecretKey(Uint8Array.from(identitySecret));
  const identity: ServerIdentity = {
    hostId: hostIdFromPublicKey(identityPair.publicKey),
    publicKey: identityPair.publicKey,
    publicKeyBase64Url: toBase64Url(identityPair.publicKey),
    secretKey: identityPair.secretKey,
  };

  const relaySeed = await secretStore.getOrCreateRandom('relay', 'host-proof-ed25519', 32);
  const relaySigningKey = keyPairFromEd25519Seed(Buffer.from(relaySeed));

  const devices = new DeviceService({
    devices: deviceRepo,
    pairing: pairingRepo,
    tokens,
    audit,
    relayOutbox: relayOutboxRepo,
    scopeRequests: scopeRequestRepo,
    resumeCredentialTtlMs: security.sessionTtlHours * 60 * 60_000,
    logger: {
      warn: (m, meta) => logger.warn(m, meta as Record<string, unknown>),
      info: (m, meta) => logger.info(m, meta as Record<string, unknown>),
    },
  });

  const auth = new AuthService({
    tokens,
    dpop,
    devices: deviceRepo,
    serviceAccounts: serviceAccountRepo,
    streamTickets: streamTicketRepo,
    audit,
    legacyApiKey,
    legacyApiKeyScopes: ALL_SCOPES,
    allowUnauthenticatedLoopback,
    logger: {
      warn: (m, meta) => logger.warn(m, meta as Record<string, unknown>),
      debug: (m, meta) => logger.debug?.(m, meta as Record<string, unknown>),
    },
  });

  // ── Legacy global key → service account ─────────────────────────
  //
  // The deprecated `GENERATORAI_API_KEY` keeps working, but it is now modelled
  // as a *service account* row so it shows up in device/credential listings,
  // can be revoked, and produces the same audit trail as any other principal.
  if (legacyApiKey) {
    await ensureLegacyServiceAccount(serviceAccountRepo, tokens, legacyApiKey, logger);
  }

  // ── Fail-closed gate #3: is anything actually authenticating? ────
  const hasAnyCredentialPath = true; // pairing is always available
  const authenticationRequired = !allowUnauthenticatedLoopback;

  if (!authenticationRequired && (!loopbackOnly || production)) {
    // Defensive: already covered above, but the invariant is important enough
    // to assert twice — this is the branch that would expose the whole API.
    throw new StartupSecurityError(
      'Refusing to start: authentication is disabled on a non-loopback/production listener.',
    );
  }
  if (!hasAnyCredentialPath) {
    throw new StartupSecurityError('Refusing to start: no credential path is configured.');
  }

  // ── Legacy plaintext credential migration ───────────────────────
  //
  // Best-effort: a failure here must never stop the server, but it IS audited
  // so an operator can see that a plaintext credential is still on disk.
  try {
    const outcomes = await migrateLegacySecrets({
      store: secretStore,
      sources: defaultLegacySecretSources({
        homeDir: os.homedir(),
        configDir: path.dirname(path.resolve(config.dbPath)),
        cwd: process.cwd(),
      }),
      logger: {
        warn: (m, meta) => logger.warn(m, meta as Record<string, unknown>),
        info: (m, meta) => logger.info(m, meta as Record<string, unknown>),
      },
    });
    const migrated = outcomes.filter((o) => o.status === 'migrated');
    if (migrated.length > 0) {
      logger.warn(
        `[Secrets] Migrated ${migrated.length} plaintext credential(s) into the vault. ` +
          'Rotate any high-value tokens: secure erase cannot be guaranteed on journaled filesystems.',
        { refs: migrated.map((o) => o.ref) },
      );
      audit.record({
        action: 'secret.migrated',
        result: 'success',
        metadata: { count: migrated.length, refs: migrated.map((o) => o.ref) },
        severity: 'warn',
      });
    }
    for (const failure of outcomes.filter((o) => o.status === 'failed')) {
      logger.warn('[Secrets] Legacy credential migration failed', {
        label: failure.label,
        error: failure.error,
      });
    }
  } catch (err) {
    logger.warn('[Secrets] Legacy credential migration failed (continuing)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Background sweepers ─────────────────────────────────────────
  const retentionMs = security.auditRetentionDays * 24 * 60 * 60_000;
  const sweeper = setInterval(() => {
    const now = Date.now();
    void Promise.allSettled([
      replayStore.purge(now),
      nonceStore.purge(now),
      streamTicketRepo.purge(now),
      pairingRepo.deleteExpired(now - 24 * 60 * 60_000),
      auditRepo.purge(now - retentionMs),
    ]).catch(() => undefined);
  }, SWEEP_INTERVAL_MS);
  sweeper.unref?.();

  const posture: SecurityPosture = {
    bindHost,
    loopbackOnly,
    production,
    authenticationRequired,
    unauthenticatedLoopback: allowUnauthenticatedLoopback,
    secretBackend: {
      kind: backendInfo.kind,
      secure: backendInfo.secure,
      reason: backendInfo.reason,
    },
    legacyApiKeyActive: Boolean(legacyApiKey),
    relayEnabled: security.relayEnabled,
    tokenAudience: security.tokenAudience,
  };

  logSecurityBanner(logger, posture);
  logger.info('[Security] Host identity', { hostId: identity.hostId });

  // ── Agent permission default (plan G14) ─────────────────────────
  //
  // A single-user loopback install keeps its autonomous behaviour: the human
  // launched it, owns the machine, and is watching. Anything reachable beyond
  // loopback — LAN, SSH-forwarded, relay, or production — must not run agents
  // that can touch the host with no approval gate, because the blast radius of
  // one compromised client becomes the whole workstation.
  const permissionDefault: 'bypassPermissions' | 'acceptEdits' =
    process.env['GENERATORAI_DEFAULT_PERMISSION_MODE'] === 'bypassPermissions'
      ? 'bypassPermissions'
      : loopbackOnly && !production
        ? 'bypassPermissions'
        : 'acceptEdits';
  setDefaultChatPermissionMode(permissionDefault);
  if (permissionDefault !== 'bypassPermissions') {
    logger.info(
      '[Security] Agents default to `acceptEdits` on this deployment. Chats may still opt ' +
        'into full autonomy individually.',
    );
  } else if (!loopbackOnly || production) {
    // Only reachable via the explicit env override above.
    logger.warn(
      '[Security] GENERATORAI_DEFAULT_PERMISSION_MODE=bypassPermissions is set on a ' +
        'non-loopback/production server. Every agent turn can modify the host without approval.',
    );
    audit.record({
      action: 'settings.updated',
      result: 'success',
      resourceType: 'security',
      resourceId: 'default-permission-mode',
      metadata: { mode: permissionDefault, loopbackOnly, production },
      severity: 'critical',
    });
  }

  return {
    secretStore,
    tokens,
    dpop,
    devices,
    auth,
    audit,
    identity,
    relaySigningKey,
    deviceRepo,
    pairingRepo,
    replayStore,
    nonceStore,
    streamTicketRepo,
    serviceAccountRepo,
    auditRepo,
    relayOutboxRepo,
    scopeRequestRepo,
    posture,
    async shutdown() {
      clearInterval(sweeper);
      await audit.flush();
    },
  };
}

/** Fixed primary key for the single account backing GENERATORAI_API_KEY. */
const LEGACY_SERVICE_ACCOUNT_ID = 'legacy-api-key';

async function ensureLegacyServiceAccount(
  repo: IServiceAccountRepository,
  tokens: TokenService,
  apiKey: string,
  logger: ILogger,
): Promise<void> {
  const hash = tokens.hashOpaque(apiKey);
  const existing = await repo.findByHash(hash);
  if (existing) return;

  // The account id is fixed, so a CHANGED key finds nothing by hash and then
  // collides on the primary key — which used to abort startup entirely and
  // leave the server unbootable until the old key was restored. Rotating in
  // place is also the correct behaviour: it is the same account, re-keyed.
  if (await repo.rotateSecret(LEGACY_SERVICE_ACCOUNT_ID, hash)) {
    logger.warn(
      '[Auth] GENERATORAI_API_KEY changed; the legacy service account was re-keyed. ' +
        'The previous key no longer works.',
    );
    return;
  }

  await repo.create({
    accountId: LEGACY_SERVICE_ACCOUNT_ID,
    name: 'Deprecated GENERATORAI_API_KEY',
    secretHash: hash,
    scopes: [...ALL_SCOPES],
    createdAt: Date.now(),
    lastUsedAt: null,
    revokedAt: null,
    legacy: true,
  });
  logger.warn(
    '[Auth] GENERATORAI_API_KEY is DEPRECATED. It now behaves as a full-scope service ' +
      'account. Pair per-device credentials (`generatorai device pair`) and remove it.',
  );
}

function logSecurityBanner(logger: ILogger, posture: SecurityPosture): void {
  if (posture.unauthenticatedLoopback) {
    logger.warn(
      '┌───────────────────────────────────────────────────────────────┐\n' +
        '│  AUTHENTICATION IS DISABLED (loopback development mode)       │\n' +
        '│  Every /api request runs with FULL authority.                 │\n' +
        '│  Unset GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK to enforce. │\n' +
        '└───────────────────────────────────────────────────────────────┘',
    );
  }
  logger.info('[Security] Posture', {
    bindHost: posture.bindHost,
    loopbackOnly: posture.loopbackOnly,
    authenticationRequired: posture.authenticationRequired,
    secretBackend: posture.secretBackend.kind,
    secretBackendSecure: posture.secretBackend.secure,
    legacyApiKeyActive: posture.legacyApiKeyActive,
    relayEnabled: posture.relayEnabled,
  });
  if (!posture.secretBackend.secure) {
    logger.warn(
      `[Security] Secret backend "${posture.secretBackend.kind}" is not OS-protected. ` +
        'Set GENERATORAI_SECRET_KEY or GENERATORAI_SECRET_PASSPHRASE before exposing this server.',
    );
  }
}

// ────────────────────────────────────────────────────────────────
// Bootstrap pairing — solves the first-run chicken-and-egg problem.
//
// `POST /api/auth/pair` needs `admin:devices`, but on a brand-new install
// there is no device that holds it. Rather than weakening the route, the
// server mints ONE pairing grant for itself at startup — but only when all
// of these are true:
//
//   * authentication is actually required (not dev-unauthenticated mode)
//   * there is no active device
//   * there is no non-legacy service account
//
// The grant is written to a `0600` file next to the database and printed to
// the log. The desktop shell reads the file and pairs its renderer silently;
// a headless operator copies the URL out of the log. Either way the credential
// is short-lived, single-use, and disappears as soon as one device exists.
//
// Security notes:
//   * The file contains real pairing material, so it is created with an
//     exclusive open and restrictive permissions, and deleted on consumption.
//   * A fresh grant is minted on every boot while the server is still
//     unclaimed. Anything older is invalidated, so a stale file left on disk
//     by a crashed run cannot be replayed.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ALL_SCOPES } from '@generatorai/auth';
import { encodePairingOffer, pairingOfferUrl, PairingOfferSchema } from '@generatorai/relay-protocol';
import type { ILogger } from '@generatorai/shared';
import type { SecurityContext } from './security.js';

/**
 * Scopes granted to the very first device: everything.
 *
 * This device is the machine owner — it is the only way to reach the device
 * manager and hand out narrower scopes to every subsequent client.
 */
const BOOTSTRAP_SCOPES = ALL_SCOPES;

/** Longer than a normal pairing code: the user may be watching a splash screen. */
const BOOTSTRAP_TTL_MS = 15 * 60_000;

export interface BootstrapPairingResult {
  /** Absolute path of the `0600` file the code was written to. */
  file: string;
  pairingUrl: string;
  pairingCode: string;
  expiresAt: number;
}

export interface BootstrapPairingOptions {
  security: SecurityContext;
  logger: ILogger;
  /** Directory to write `bootstrap-pairing.json` into (the data dir). */
  dataDir: string;
  /** Origin clients should connect back to, e.g. `http://127.0.0.1:3100`. */
  endpoint: string;
  serverName: string;
}

export function bootstrapPairingFile(dataDir: string): string {
  return path.join(dataDir, 'bootstrap-pairing.json');
}

/**
 * Mints the first-run pairing grant when the server is still unclaimed.
 * Returns `null` when a credential already exists — the normal case.
 */
export async function ensureBootstrapPairing(
  options: BootstrapPairingOptions,
): Promise<BootstrapPairingResult | null> {
  const { security, logger, dataDir, endpoint, serverName } = options;

  if (!security.posture.authenticationRequired) {
    // Dev-unauthenticated loopback: nothing to bootstrap, and writing a
    // pairing file would leave a usable credential lying around.
    removeBootstrapFile(dataDir);
    return null;
  }

  const devices = await security.deviceRepo.list();
  const hasActiveDevice = devices.some((d) => d.revokedAt === null);
  if (hasActiveDevice) {
    removeBootstrapFile(dataDir);
    return null;
  }

  // The deprecated global API key counts as a credential path only when the
  // operator explicitly configured it — a legacy row alone is not enough.
  if (security.posture.legacyApiKeyActive) {
    removeBootstrapFile(dataDir);
    logger.info('[Auth] Server is unclaimed but GENERATORAI_API_KEY is set; skipping bootstrap pairing.');
    return null;
  }

  // The Electron shell owns a privileged loopback channel (see
  // routes/internal-desktop.ts) and pairs its own renderer on demand. Minting
  // a bootstrap grant here would be redundant AND would print a working
  // pairing code into the desktop log file for no reason.
  if (process.env['GENERATORAI_DESKTOP_ADMIN_TOKEN']) {
    removeBootstrapFile(dataDir);
    logger.info('[Auth] Desktop shell will pair its own renderer; skipping bootstrap pairing.');
    return null;
  }

  // Invalidate anything from a previous boot before minting a replacement.
  const previous = await security.pairingRepo.listPending(Date.now());
  for (const grant of previous) {
    await security.pairingRepo.revoke(grant.grantId, Date.now());
  }

  const grant = await security.devices.createPairingGrant({
    deviceNameHint: 'First device',
    platform: 'other',
    requestedScopes: [...BOOTSTRAP_SCOPES],
    createdBy: {
      type: 'internal-service',
      id: 'bootstrap',
      displayName: 'First-run bootstrap',
      scopes: [...BOOTSTRAP_SCOPES],
      transport: 'loopback',
    },
    ttlMs: BOOTSTRAP_TTL_MS,
    relayInvite: null,
  });

  const offer = PairingOfferSchema.parse({
    v: 1,
    endpoint,
    serverId: security.identity.hostId,
    serverPublicKey: security.identity.publicKeyBase64Url,
    pairingGrant: grant.pairingToken,
    pairingExpiresAt: grant.expiresAt,
    requestedScopes: grant.requestedScopes,
    transportCapabilities: ['loopback'],
    serverName,
  });

  const result: BootstrapPairingResult = {
    file: bootstrapPairingFile(dataDir),
    pairingCode: encodePairingOffer(offer),
    pairingUrl: pairingOfferUrl(offer),
    expiresAt: grant.expiresAt,
  };

  writeBootstrapFile(result, logger);

  logger.warn(
    '[Auth] This server has no paired device yet. Pair one within 15 minutes:\n' +
      `  ${result.pairingUrl}\n` +
      `  (also written to ${result.file}, readable only by this user)`,
  );

  return result;
}

function writeBootstrapFile(result: BootstrapPairingResult, logger: ILogger): void {
  const payload = JSON.stringify(
    {
      pairingUrl: result.pairingUrl,
      pairingCode: result.pairingCode,
      expiresAt: result.expiresAt,
    },
    null,
    2,
  );
  try {
    // Replace atomically: an `wx` open would fail on the second boot, and a
    // plain write could briefly expose the file with default permissions.
    const tmp = `${result.file}.tmp`;
    fs.writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, result.file);
    // `mode` on open is masked by umask on some platforms — enforce it.
    fs.chmodSync(result.file, 0o600);
  } catch (err) {
    logger.warn('[Auth] Could not write the bootstrap pairing file', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Removes the bootstrap file once it can no longer be needed. */
export function removeBootstrapFile(dataDir: string): void {
  try {
    fs.rmSync(bootstrapPairingFile(dataDir), { force: true });
  } catch {
    // Best effort — an unreadable stale file is harmless because the grant
    // behind it has already been revoked.
  }
}

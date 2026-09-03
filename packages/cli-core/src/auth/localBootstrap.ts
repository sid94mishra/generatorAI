// ────────────────────────────────────────────────────────────────
// The local-machine bootstrap channel — how a CLI with no paired device yet
// gets one, using only proof that it runs as the same OS user as the server.
//
// Two server-side mechanisms feed this (see apps/server/src/composition
// /bootstrapPairing.ts and routes/internal-desktop.ts):
//
//   - `bootstrap-pairing.json`: an ALL_SCOPES pairing grant the server mints
//     ITSELF at startup while unclaimed (no active device yet). Reading it
//     needs no credential and touches no network — the file's existence in a
//     data directory this OS user can see IS the proof.
//   - `POST /internal/desktop/pairing`: a loopback-only, local-admin-token
//     gated recovery channel for when devices exist but every one of them is
//     lost or revoked. This one does need a network round trip, because a
//     fresh grant has to be minted on demand.
//
// The rule that makes the second path safe: the local-admin bearer token
// must NEVER be sent anywhere but a verified loopback origin. It is proof
// that this process owns the machine the server runs on; sending it to a
// configured remote `baseUrl` would hand that proof to whatever happens to
// be listening there instead.
// ────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { isLoopbackHost } from '@generatorai/shared';

export interface BootstrapPairingMaterial {
  pairingCode: string;
  pairingUrl?: string;
  expiresAt: number;
}

/**
 * True when `origin` can only ever resolve back to this machine.
 *
 * Delegates to `isLoopbackHost` (packages/shared) rather than reimplementing
 * the check — this decision ("is it safe to send a machine-owner secret
 * here") is exactly the kind of thing that must have ONE definition, not a
 * second one that can quietly drift (e.g. this file's own first attempt
 * skipped the IPv4 octet-range check `isLoopbackHost` already has, and
 * accepted only a full URL rather than also a bare host or `host:port`).
 */
export function isLoopbackOrigin(origin: string): boolean {
  return isLoopbackHost(origin);
}

/**
 * Reads the server's self-minted unclaimed-install pairing grant, if one is
 * present and unexpired. Deliberately tolerant of a missing or malformed
 * file: the normal case, once a device exists, is that this file is gone.
 */
export function readBootstrapPairingFile(dataDir: string): BootstrapPairingMaterial | null {
  try {
    const path = `${dataDir.replace(/[\\/]+$/, '')}/bootstrap-pairing.json`;
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as
      | { pairingCode?: unknown; pairingUrl?: unknown; expiresAt?: unknown }
      | null;
    if (!parsed || typeof parsed.pairingCode !== 'string' || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    if (parsed.expiresAt <= Date.now()) return null;
    return {
      pairingCode: parsed.pairingCode,
      ...(typeof parsed.pairingUrl === 'string' ? { pairingUrl: parsed.pairingUrl } : {}),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export type LocalBootstrapErrorCode = 'NOT_LOOPBACK' | 'UNREACHABLE' | 'UNAUTHORIZED' | 'FAILED';

export class LocalBootstrapError extends Error {
  constructor(
    readonly code: LocalBootstrapErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LocalBootstrapError';
  }
}

export interface RecoveryPairingResult {
  pairingCode: string;
  pairingUrl: string;
  shortCode: string;
  expiresAt: number;
}

/**
 * Redeems the local-admin recovery token for a fresh pairing grant.
 *
 * Refuses outright unless `baseUrl` is a verified loopback origin. That
 * check runs BEFORE anything is sent, so a misconfigured or attacker-supplied
 * remote `baseUrl` never sees the token at all.
 */
export async function requestRecoveryPairing(
  baseUrl: string,
  token: string,
  deviceName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RecoveryPairingResult> {
  if (!isLoopbackOrigin(baseUrl)) {
    throw new LocalBootstrapError(
      'NOT_LOOPBACK',
      `Refusing to send the local admin token to "${baseUrl}" — it is not a loopback address.`,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/internal/desktop/pairing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceName }),
    });
  } catch (error) {
    throw new LocalBootstrapError('UNREACHABLE', `Could not reach ${baseUrl} — is the server running there?`, error);
  }

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new LocalBootstrapError(
      response.status === 401 ? 'UNAUTHORIZED' : 'FAILED',
      detail?.error?.message ?? `Could not mint a recovery pairing grant (HTTP ${response.status}).`,
    );
  }

  const body = (await response.json()) as Partial<RecoveryPairingResult> | null;
  if (
    !body ||
    typeof body.pairingCode !== 'string' ||
    typeof body.pairingUrl !== 'string' ||
    typeof body.shortCode !== 'string' ||
    typeof body.expiresAt !== 'number'
  ) {
    throw new LocalBootstrapError('FAILED', 'The server returned an unexpected recovery response.');
  }
  return {
    pairingCode: body.pairingCode,
    pairingUrl: body.pairingUrl,
    shortCode: body.shortCode,
    expiresAt: body.expiresAt,
  };
}

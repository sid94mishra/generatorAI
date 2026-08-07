// ────────────────────────────────────────────────────────────────
// Local admin token — proof that a caller owns this machine.
// ────────────────────────────────────────────────────────────────
//
// Minting a pairing code requires `admin:devices`. That is correct, and it
// creates one dead end: if the only device holding that scope is lost — a
// cleared browser profile, a wiped phone, a revoked laptop — nobody can mint
// the code that would let a replacement device in. The server is healthy, the
// data is intact, and the owner is locked out of their own machine.
//
// The Electron shell already solves this for itself with a per-launch token
// shared between two co-resident processes (see routes/internal-desktop.ts).
// This file generalises that proof to anything running as the same OS user:
// the token is written to a mode-0600 file inside the server's data directory,
// so reading it requires the account that owns the server.
//
// Why this is not a backdoor:
//   * the file is owner-only, so "can read it" means "is the user who runs
//     the server" — the same authority that could edit the database directly
//   * the route that accepts it is loopback-only, so possessing the token
//     over the network is useless
//   * the token is regenerated on every start, so a copy taken from a backup
//     or an old shell session is inert
//   * it can only ever produce *pairing* material: a single-use, 10-minute,
//     5-attempt grant that is fully audited, never a token or device secret
//
// It is deliberately NOT written when authentication is disabled, because
// there is nothing to recover into — and leaving a live credential on disk
// for a server that already trusts every loopback caller is pure downside.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

const FILE_NAME = 'local-admin.json';

export interface LocalAdminToken {
  token: string;
  pid: number;
  startedAt: number;
}

export function localAdminTokenPath(dataDir: string): string {
  return path.join(dataDir, FILE_NAME);
}

/** Mints a token for this process. Not written to disk until {@link publishLocalAdminToken}. */
export function mintLocalAdminToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Publishes the token so a local CLI can find it.
 *
 * Deliberately called only AFTER the listener binds. A second server started
 * against the same data directory fails on `EADDRINUSE`, and if it had already
 * written its token it would leave the file describing a process that never
 * came up — silently locking the recovery path out of the server that is
 * actually running.
 */
export function publishLocalAdminToken(dataDir: string, token: string): void {
  const payload: LocalAdminToken = {
    token,
    pid: process.pid,
    startedAt: Date.now(),
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(localAdminTokenPath(dataDir), `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
}

/** Reads the current token, or null when the file is absent or malformed. */
export function readLocalAdminToken(dataDir: string): string | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(localAdminTokenPath(dataDir), 'utf8'));
    const token = (parsed as { token?: unknown } | null)?.token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function removeLocalAdminToken(dataDir: string): void {
  try {
    fs.rmSync(localAdminTokenPath(dataDir), { force: true });
  } catch {
    // Best effort: a leftover file is inert once this process exits, because
    // the route only ever accepts the token held in memory by the live server.
  }
}

// ────────────────────────────────────────────────────────────────
// Network exposure mode — "can other devices on my network reach this?"
// ────────────────────────────────────────────────────────────────
//
// Binding to a routable interface used to require editing `GENERATORAI_BIND_HOST`
// in a `.env` file and restarting by hand. That is a reasonable operator knob
// and a terrible product affordance: the single most common thing a user wants
// ("open this on my laptop too") should not require finding a dotfile.
//
// This module makes the mode a persisted SETTING that the app can flip, while
// keeping the env var as an override so an operator deploying the server still
// has the final say.
//
// It deliberately does NOT relax either startup security gate:
//   * unauthenticated loopback mode is incompatible with network exposure, and
//     `createSecurityContext` still refuses to start if both are set;
//   * off-loopback binding still demands a secure secret backend.
// The toggle's job is to make those requirements explicit and checkable BEFORE
// restarting, not to bypass them — see `describeExposurePreconditions`.

import * as fs from 'node:fs';
import * as path from 'node:path';

export type NetworkExposureMode = 'local-only' | 'network-accessible';

/** Bind address for each mode. */
const BIND_HOSTS: Record<NetworkExposureMode, string> = {
  // IPv4 loopback only. Not `localhost`, which can resolve to ::1 on some
  // systems and silently produce a listener the rest of the app's loopback
  // checks do not recognise.
  'local-only': '127.0.0.1',
  // All interfaces. The alternative — binding one specific LAN IP — breaks the
  // moment the machine changes network or the DHCP lease moves.
  'network-accessible': '0.0.0.0',
};

const STATE_FILE = 'network-exposure.json';

function stateFilePath(dataDir: string): string {
  return path.join(dataDir, STATE_FILE);
}

/**
 * Reads the persisted mode, defaulting to `local-only`.
 *
 * Any unreadable or malformed state falls back to `local-only` rather than
 * propagating an error: a corrupt settings file must never be able to expose a
 * server that was not previously exposed.
 */
export function readExposureMode(dataDir: string): NetworkExposureMode {
  try {
    const raw = fs.readFileSync(stateFilePath(dataDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const mode = (parsed as { mode?: unknown } | null)?.mode;
    return mode === 'network-accessible' ? 'network-accessible' : 'local-only';
  } catch {
    return 'local-only';
  }
}

/** Persists the mode. Takes effect on the next start. */
export function writeExposureMode(dataDir: string, mode: NetworkExposureMode): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    stateFilePath(dataDir),
    `${JSON.stringify({ mode, updatedAt: Date.now() }, null, 2)}\n`,
    // Owner-only: the file decides whether this machine accepts connections
    // from the network, so it should not be world-writable.
    { mode: 0o600 },
  );
}

/**
 * Resolves the address to bind.
 *
 * `GENERATORAI_BIND_HOST` wins when set, because an operator who pinned a bind
 * address in the environment should not have it silently overridden by a
 * setting a UI toggled.
 */
export function resolveBindHost(input: {
  envBindHost?: string | undefined;
  mode: NetworkExposureMode;
}): string {
  const env = input.envBindHost?.trim();
  if (env) return env;
  return BIND_HOSTS[input.mode];
}

export interface ExposurePrecondition {
  /** Stable identifier the UI can branch on. */
  code: 'unauthenticated_loopback' | 'insecure_secret_store';
  message: string;
}

/**
 * Lists the reasons this server cannot currently be exposed to the network.
 *
 * Returned BEFORE anything is persisted, so the UI can explain the problem
 * while the server is still running, rather than letting the user flip a
 * toggle and then discover a server that refuses to boot.
 */
export function describeExposurePreconditions(input: {
  unauthenticatedLoopback: boolean;
  secretStoreSecure: boolean;
}): ExposurePrecondition[] {
  const blockers: ExposurePrecondition[] = [];

  if (input.unauthenticatedLoopback) {
    blockers.push({
      code: 'unauthenticated_loopback',
      message:
        'This server currently accepts unauthenticated requests because ' +
        'GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1. That is only safe on loopback. ' +
        'Remove it so connecting devices must pair before they get access.',
    });
  }

  if (!input.secretStoreSecure) {
    blockers.push({
      code: 'insecure_secret_store',
      message:
        'Secrets are protected by a key file that any local user can read, which is not ' +
        'strong enough for a server reachable from the network. Run the desktop app (which ' +
        'uses the OS keychain) or set GENERATORAI_SECRET_KEY.',
    });
  }

  return blockers;
}

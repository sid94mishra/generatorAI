// ────────────────────────────────────────────────────────────────
// Device administration — the pure half.
//
// What an `admin:devices` phone may do to ANOTHER device from Settings ›
// Security: change its scopes, rotate its credentials, and mint a pairing
// code for a new one. The rules that decide what the UI offers live here so
// they are tested without React Native:
//
//   PUT  /api/auth/devices/:id/scopes   {scopes}   → 204 (replaces, not merges)
//   POST /api/auth/devices/:id/rotate               → 200 (ends its sessions)
//   POST /api/auth/pair                 {deviceName, platform, scopes?, ttlMs?}
//                                                   → 201 PairingInvite
//
// The server's `updateDeviceScopes` refuses to grant beyond the caller's own
// authority, so the editor disables scopes this phone does not hold instead
// of letting the save fail with a 403.
// ────────────────────────────────────────────────────────────────

import { SCOPE_PRESETS, type ScopePreset } from '../../auth/scopePresets';

/**
 * Every scope the server knows, in the server's order. Mirrors `SCOPES` in
 * packages/auth/src/scopes.ts (the test asserts it). The Administrator
 * preset is exactly that set.
 */
export const ALL_KNOWN_SCOPES: readonly string[] =
  SCOPE_PRESETS.find((preset) => preset.id === 'admin')?.scopes ?? [];

export interface ScopeDiff {
  added: string[];
  removed: string[];
}

export function diffScopes(before: readonly string[], after: readonly string[]): ScopeDiff {
  const prev = new Set(before);
  const next = new Set(after);
  return {
    added: [...next].filter((scope) => !prev.has(scope)),
    removed: [...prev].filter((scope) => !next.has(scope)),
  };
}

/** Sensitive scopes a save would ADD — the trigger for a biometric step-up. */
export function sensitiveAdditions(
  before: readonly string[],
  after: readonly string[],
  isSensitive: (scope: string) => boolean,
): string[] {
  return diffScopes(before, after).added.filter(isSensitive);
}

/**
 * Whether this phone may GRANT `scope`. Withdrawing is always allowed — the
 * server only refuses escalation beyond the caller's own grant.
 */
export function canGrantScope(callerScopes: readonly string[], scope: string): boolean {
  return callerScopes.includes(scope);
}

/**
 * Toggle one scope. Granting a scope the caller does not hold is a no-op
 * (the switch is disabled, but the rule is not left to the view).
 */
export function toggleScope(
  current: readonly string[],
  scope: string,
  on: boolean,
  callerScopes: readonly string[],
): string[] {
  if (on) {
    if (current.includes(scope) || !canGrantScope(callerScopes, scope)) return [...current];
    return [...current, scope];
  }
  return current.filter((s) => s !== scope);
}

/**
 * Apply a preset, keeping only what the caller can grant — plus anything the
 * device already holds that is in the preset (a lower-authority admin must
 * not strip a scope merely by re-selecting the preset it already matches).
 */
export function applyPreset(
  preset: ScopePreset,
  current: readonly string[],
  callerScopes: readonly string[],
): string[] {
  return preset.scopes.filter((scope) => current.includes(scope) || canGrantScope(callerScopes, scope));
}

/** The scopes the editor lists: every known scope, then any unknown ones the device holds. */
export function editableScopeList(deviceScopes: readonly string[]): string[] {
  const extra = deviceScopes.filter((scope) => !ALL_KNOWN_SCOPES.includes(scope));
  return [...ALL_KNOWN_SCOPES, ...extra];
}

/** Order-insensitive equality — "nothing to save". */
export function sameScopes(a: readonly string[], b: readonly string[]): boolean {
  const diff = diffScopes(a, b);
  return diff.added.length === 0 && diff.removed.length === 0;
}

// ── Request shapes ──────────────────────────────────────────────

export interface JsonRequest {
  path: string;
  init: { method: 'PUT' | 'POST'; headers: Record<string, string>; body: string };
}

export function setDeviceScopesRequest(deviceId: string, scopes: readonly string[]): JsonRequest {
  return {
    path: `/api/auth/devices/${encodeURIComponent(deviceId)}/scopes`,
    init: {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scopes: [...new Set(scopes)] }),
    },
  };
}

export function rotateDeviceRequest(deviceId: string): JsonRequest {
  return {
    path: `/api/auth/devices/${encodeURIComponent(deviceId)}/rotate`,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  };
}

/** Mirrors `PLATFORMS` in apps/server/src/routes/auth.ts. */
export type PairingPlatform = 'web' | 'desktop' | 'cli' | 'mobile' | 'other';

export const PAIRING_TTL_MS = { min: 30_000, max: 10 * 60_000, default: 5 * 60_000 } as const;

export interface CreatePairingInput {
  deviceName: string;
  platform: PairingPlatform;
  scopes?: readonly string[];
  ttlMs?: number;
}

export function createPairingRequest(input: CreatePairingInput): JsonRequest {
  // The server requires 1–64 characters; an empty field must not be a 400.
  const name = input.deviceName.trim().slice(0, 64) || 'New device';
  const ttl = input.ttlMs ?? PAIRING_TTL_MS.default;
  return {
    path: '/api/auth/pair',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceName: name,
        platform: input.platform,
        ...(input.scopes ? { scopes: [...new Set(input.scopes)] } : {}),
        ttlMs: Math.min(PAIRING_TTL_MS.max, Math.max(PAIRING_TTL_MS.min, Math.round(ttl))),
      }),
    },
  };
}

/** `POST /api/auth/pair` → 201. */
export interface PairingInvite {
  grantId: string;
  expiresAt: number;
  requestedScopes: string[];
  serverId: string;
  shortCode: string;
  joinUrl: string;
  pairingCode: string;
  pairingUrl: string;
}

export function parsePairingInvite(body: unknown): PairingInvite | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const str = (key: string): string | null => (typeof b[key] === 'string' && b[key] ? (b[key] as string) : null);
  const grantId = str('grantId');
  const shortCode = str('shortCode');
  const pairingUrl = str('pairingUrl');
  const expiresAt = typeof b.expiresAt === 'number' ? b.expiresAt : Number.NaN;
  if (!grantId || !shortCode || !pairingUrl || !Number.isFinite(expiresAt)) return null;
  return {
    grantId,
    expiresAt,
    requestedScopes: Array.isArray(b.requestedScopes)
      ? b.requestedScopes.filter((s): s is string => typeof s === 'string')
      : [],
    serverId: str('serverId') ?? '',
    shortCode,
    joinUrl: str('joinUrl') ?? '',
    pairingCode: str('pairingCode') ?? '',
    pairingUrl,
  };
}

/** Seconds left on an invite, never negative. */
export function secondsRemaining(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/** "4:05" — stable width for a ticking countdown. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Whether a pairing invite with this preset can be minted by the caller —
 * `createPairingGrant` rejects any scope beyond the creator's own.
 */
export function presetWithinAuthority(preset: ScopePreset, callerScopes: readonly string[]): boolean {
  return preset.scopes.every((scope) => canGrantScope(callerScopes, scope));
}

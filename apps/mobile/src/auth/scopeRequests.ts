// ────────────────────────────────────────────────────────────────
// Scope requests — what this device lacks, and what the server's answer means.
//
// Pure data for the `/scope-request` sheet. The request itself goes
// through `api.auth.scopeRequests.create` (client-core, see
// `src/api/scopeRequests.ts` for the hooks); this module only decides
// WHICH scopes can be asked for and how to read the HTTP outcome. Until a
// server has the route it answers 404, and the sheet says so instead of
// showing a button that fails.
// ────────────────────────────────────────────────────────────────

import { FEATURE_REQUIREMENTS, grantableFeatures, isScopeRequestable, type MobileFeature } from './featureGate';

export interface MissingScope {
  scope: string;
  /** Features this scope would unlock, for the row subtitle. */
  features: MobileFeature[];
}

/**
 * Scopes this device could be granted, each with the features it unlocks.
 * Only grantable features count — `projectEdit` is structurally impossible
 * on a phone and must not be requestable.
 */
export function missingGrantableScopes(grantedScopes: readonly string[]): MissingScope[] {
  const granted = new Set(grantedScopes);
  const byScope = new Map<string, MobileFeature[]>();
  for (const feature of grantableFeatures(grantedScopes)) {
    for (const scope of FEATURE_REQUIREMENTS[feature].scopes) {
      if (granted.has(scope)) continue;
      // The server refuses admin:* requests from a device holding no admin
      // scope (403 SCOPE_NOT_REQUESTABLE); offering them only produced errors.
      if (!isScopeRequestable(scope, grantedScopes)) continue;
      const list = byScope.get(scope) ?? [];
      list.push(feature);
      byScope.set(scope, list);
    }
  }
  return [...byScope.entries()].map(([scope, features]) => ({ scope, features }));
}

/** The body `POST /api/auth/devices/me/scope-requests` accepts, or null when there is nothing to ask for. */
export function scopeRequestBody(
  scopes: readonly string[],
  reason: string,
): { scopes: string[]; reason?: string } | null {
  const unique = [...new Set(scopes.filter((s) => s.trim().length > 0))];
  if (unique.length === 0) return null;
  const trimmed = reason.trim();
  return { scopes: unique, ...(trimmed ? { reason: trimmed } : {}) };
}

export type ScopeRequestOutcome =
  | { kind: 'sent' }
  | { kind: 'unsupported' }
  | { kind: 'forbidden' }
  | { kind: 'pending' }
  | { kind: 'failed'; status: number };

/**
 * What an HTTP status means for the sheet.
 *
 *   2xx  sent
 *   404  the server predates the route — tell the user where to grant it
 *   403  the server has the route but refuses this device (or the scope)
 *   409  a request from this device is already waiting
 */
export function scopeRequestOutcome(status: number): ScopeRequestOutcome {
  if (status >= 200 && status < 300) return { kind: 'sent' };
  if (status === 404) return { kind: 'unsupported' };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 409) return { kind: 'pending' };
  return { kind: 'failed', status };
}

export const UNSUPPORTED_MESSAGE =
  'Your server needs an update to receive requests. Ask an admin to grant it in Settings › Security on the desktop.';

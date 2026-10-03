// MB-38 / MScopeRequest (MD-30, MDF-124): where a request for some scopes stands, from this device's grant and its
// own requests (MG-01 self-service reads). Pure.
import type { DeviceScopeRequest } from '@generatorai/client-core';
import { isSensitiveScope, scopeLabel } from '@generatorai/shared/ui-contract';

export type ScopeRequestState =
  | { kind: 'granted' }
  | { kind: 'pending'; request: DeviceScopeRequest }
  | { kind: 'denied'; request: DeviceScopeRequest }
  | { kind: 'not-requested' };

/** admin:* is only requestable by a device that already holds an admin scope (403 SCOPE_NOT_REQUESTABLE). */
export function requestable(scope: string, granted: readonly string[]): boolean {
  return !scope.startsWith('admin:') || granted.some((s) => s.startsWith('admin:'));
}

export function missingScopes(scopes: readonly string[], granted: readonly string[]): string[] {
  return [...new Set(scopes)].filter((s) => !granted.includes(s));
}

/** Newest-first requests (the API's order). A pending request that overlaps wins; then the latest denial of them. */
export function scopeRequestState(scopes: readonly string[], granted: readonly string[], mine: readonly DeviceScopeRequest[] | undefined): ScopeRequestState {
  const missing = missingScopes(scopes, granted);
  if (missing.length === 0) return { kind: 'granted' };
  const overlaps = (r: DeviceScopeRequest): boolean => r.scopes.some((s) => missing.includes(s));
  const pending = (mine ?? []).find((r) => r.status === 'pending');
  if (pending) return { kind: 'pending', request: pending };
  const last = (mine ?? []).find((r) => r.status !== 'cancelled' && overlaps(r));
  if (last?.status === 'denied') return { kind: 'denied', request: last };
  return { kind: 'not-requested' };
}

export interface ScopeRow {
  scope: string;
  label: string;
  sensitive: boolean;
  requestable: boolean;
}

export function scopeRows(scopes: readonly string[], granted: readonly string[]): ScopeRow[] {
  return missingScopes(scopes, granted).map((scope) => ({ scope, label: scopeLabel(scope), sensitive: isSensitiveScope(scope), requestable: requestable(scope, granted) }));
}

/** "3m", "2h" — how long ago a request was made. */
export function agoLabel(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

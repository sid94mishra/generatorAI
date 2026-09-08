// ────────────────────────────────────────────────────────────────
// Route policy + presets for the scope-request flow (plan S2 / §5.1).
//
// The device-side routes must be reachable with the phone's default grant
// (they are how a phone with DEFAULT_MOBILE_SCOPES asks for more), while the
// review routes must sit behind the same bar as editing scopes directly.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { requiredScopesFor, resolveRoutePolicy } from '../routePolicy.js';
import {
  DEFAULT_MOBILE_SCOPES,
  HIGH_RISK_SCOPES,
  STANDALONE_MOBILE_SCOPES,
  hasAllScopes,
} from '../scopes.js';

describe('route policy — scope requests', () => {
  it('lets a default-scope phone create, list and cancel its OWN requests', () => {
    for (const [method, path] of [
      ['POST', '/auth/devices/me/scope-requests'],
      ['GET', '/auth/devices/me/scope-requests'],
      ['DELETE', '/auth/devices/me/scope-requests/req-1'],
    ] as const) {
      const { policy, scopes } = requiredScopesFor(method, path);
      expect(policy.prefix).toBe('/auth/devices/me/scope-requests');
      expect(scopes).toEqual(['read:status']);
      expect(hasAllScopes(DEFAULT_MOBILE_SCOPES, scopes)).toBe(true);
    }
  });

  it('keeps every other /auth/devices path admin-only (longest prefix wins, not shortest)', () => {
    expect(requiredScopesFor('PUT', '/auth/devices/dev-1/scopes').scopes).toEqual(['admin:devices']);
    expect(requiredScopesFor('GET', '/auth/devices').scopes).toEqual(['admin:devices']);
    // A device literally named "me" is still addressed by id; its admin
    // routes do not inherit the device-side policy.
    expect(requiredScopesFor('PUT', '/auth/devices/me/scopes').scopes).toEqual(['admin:devices']);
    expect(resolveRoutePolicy('/auth/devices/me').prefix).toBe('/auth/devices');
  });

  it('requires admin:devices to review or resolve requests', () => {
    for (const [method, path] of [
      ['GET', '/auth/scope-requests'],
      ['POST', '/auth/scope-requests/req-1/approve'],
      ['POST', '/auth/scope-requests/req-1/deny'],
    ] as const) {
      const { policy, scopes } = requiredScopesFor(method, path);
      expect(policy.prefix).toBe('/auth/scope-requests');
      expect(policy.riskLevel).toBe('high');
      expect(scopes).toEqual(['admin:devices']);
      expect(hasAllScopes(DEFAULT_MOBILE_SCOPES, scopes)).toBe(false);
      expect(hasAllScopes(STANDALONE_MOBILE_SCOPES, scopes)).toBe(false);
    }
  });
});

describe('STANDALONE_MOBILE_SCOPES', () => {
  it('is the companion grant plus authoring, terminal and browser — no admin, no computer', () => {
    for (const scope of DEFAULT_MOBILE_SCOPES) expect(STANDALONE_MOBILE_SCOPES).toContain(scope);
    for (const scope of [
      'write:workspaces',
      'write:files',
      'write:workflows',
      'write:projects',
      'exec:terminal',
      'exec:browser',
    ]) {
      expect(STANDALONE_MOBILE_SCOPES).toContain(scope);
    }
    expect(STANDALONE_MOBILE_SCOPES).not.toContain('exec:computer');
    expect(STANDALONE_MOBILE_SCOPES.some((s) => s.startsWith('admin:'))).toBe(false);
    expect(new Set(STANDALONE_MOBILE_SCOPES).size).toBe(STANDALONE_MOBILE_SCOPES.length);
  });

  it('carries the two high-risk exec scopes, so pairing on it audits at warn', () => {
    const highRisk = STANDALONE_MOBILE_SCOPES.filter((s) => HIGH_RISK_SCOPES.includes(s));
    expect(highRisk.sort()).toEqual(['exec:browser', 'exec:terminal']);
  });
});

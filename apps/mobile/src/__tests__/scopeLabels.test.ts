import { describe, expect, it } from 'vitest';
import { DEFAULT_MOBILE_SCOPES, SCOPES } from '@generatorai/auth';

import { describeScope, isSensitiveScope, SENSITIVE_SCOPES } from '../auth/scopeLabels';

describe('scope labels', () => {
  it('has a human description for EVERY scope the server can grant', () => {
    // The consent screen is the only place a user decides what a device may
    // do. A scope with no label renders as a derived guess, which is exactly
    // the situation where a user approves something they did not understand.
    const missing = SCOPES.filter((scope) => describeScope(scope) === scope);
    expect(missing, `unlabelled scopes: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not describe a scope by echoing its id', () => {
    for (const scope of SCOPES) {
      const label = describeScope(scope);
      expect(label).not.toContain(':');
      expect(label.length).toBeGreaterThan(10);
    }
  });

  it('treats exactly the non-default scopes as sensitive', () => {
    // The real rule, derived from the server rather than guessed from name
    // prefixes: a scope is sensitive iff a mobile device does NOT get it at
    // pairing. Deriving it this way means adding a scope to the server's
    // mobile defaults automatically stops it being flagged, and vice versa.
    const defaults = new Set<string>(DEFAULT_MOBILE_SCOPES);
    for (const scope of SCOPES) {
      const shouldWarn = !defaults.has(scope);
      expect(isSensitiveScope(scope), `${scope}: expected sensitive=${shouldWarn}`).toBe(shouldWarn);
    }
  });

  it('does not flag exec:agent, which is the app\u2019s whole purpose', () => {
    // Warning about the thing every user must allow trains them to click
    // through the warning that actually matters.
    expect(isSensitiveScope('exec:agent')).toBe(false);
    expect(isSensitiveScope('exec:terminal')).toBe(true);
  });

  it('does not list a sensitive scope that no longer exists', () => {
    // A stale entry here means the highlight silently stops matching.
    for (const scope of SENSITIVE_SCOPES) {
      expect(SCOPES as readonly string[]).toContain(scope);
    }
  });

  it('derives something readable for a scope from a newer server', () => {
    expect(describeScope('read:telemetry')).toBe('See telemetry');
    expect(describeScope('write:secret_vault')).toBe('Change secret vault');
  });

  it('returns the raw value for an unparseable scope rather than throwing', () => {
    expect(describeScope('nonsense')).toBe('nonsense');
  });
});

import { describe, expect, it } from 'vitest';
import { ALL_SCOPES, DEFAULT_MOBILE_SCOPES } from '@generatorai/auth';

import {
  COMPANION_SCOPES,
  SCOPE_PRESETS,
  STANDALONE_SCOPES,
  groupScopes,
  matchScopePreset,
} from '../auth/scopePresets';
import { isSensitiveScope } from '../auth/scopeLabels';

describe('scope presets', () => {
  it('companion mirrors the server’s DEFAULT_MOBILE_SCOPES exactly', () => {
    // The consent screen names this "Mobile companion"; if the server's
    // default drifts, the name would be a lie about what is being granted.
    expect([...COMPANION_SCOPES].sort()).toEqual([...DEFAULT_MOBILE_SCOPES].sort());
  });

  it('standalone is companion plus the plan §5.1 additions', () => {
    const extra = STANDALONE_SCOPES.filter((s) => !COMPANION_SCOPES.includes(s)).sort();
    expect(extra).toEqual(
      ['exec:browser', 'exec:terminal', 'write:files', 'write:projects', 'write:workflows', 'write:workspaces'].sort(),
    );
  });

  it('standalone is, as a set, the desktop’s Full workstation preset', () => {
    // One grant, one name: an offer with these scopes is shown as
    // "Full workstation" on the consent screen.
    expect(matchScopePreset(STANDALONE_SCOPES)?.id).toBe('workstation');
  });

  it('every preset scope is one the server knows', () => {
    const known = new Set<string>(ALL_SCOPES);
    for (const preset of SCOPE_PRESETS) {
      const unknown = preset.scopes.filter((s) => !known.has(s));
      expect(unknown, `${preset.id}: ${unknown.join(', ')}`).toEqual([]);
    }
  });

  it('matches an offer by set, ignoring order and duplicates', () => {
    const shuffled = [...DEFAULT_MOBILE_SCOPES].reverse();
    expect(matchScopePreset(shuffled)?.id).toBe('companion');
    expect(matchScopePreset([...shuffled, shuffled[0]!])?.id).toBe('companion');
  });

  it('does not match a superset or a subset', () => {
    expect(matchScopePreset([...DEFAULT_MOBILE_SCOPES, 'exec:terminal'])).toBeNull();
    expect(matchScopePreset(DEFAULT_MOBILE_SCOPES.slice(1))).toBeNull();
    expect(matchScopePreset([])).toBeNull();
  });

  it('presets are pairwise distinct', () => {
    for (const a of SCOPE_PRESETS) {
      for (const b of SCOPE_PRESETS) {
        if (a === b) continue;
        expect(matchScopePreset(a.scopes)?.id).toBe(a.id);
        expect(matchScopePreset(a.scopes)?.id).not.toBe(b.id);
      }
    }
  });
});

describe('groupScopes', () => {
  it('splits an offer into Read / Act / Sensitive with sensitive winning', () => {
    const groups = groupScopes(
      ['read:chats', 'stream:events', 'write:chats', 'exec:agent', 'write:files', 'exec:terminal'],
      isSensitiveScope,
    );
    expect(groups.map((g) => g.id)).toEqual(['read', 'act', 'sensitive']);
    expect(groups[0]!.scopes).toEqual(['read:chats', 'stream:events']);
    expect(groups[1]!.scopes).toEqual(['write:chats', 'exec:agent']);
    // `write:files` is a write scope AND withheld by default — the warning wins.
    expect(groups[2]!.scopes).toEqual(['write:files', 'exec:terminal']);
  });

  it('omits empty groups and drops duplicates', () => {
    const groups = groupScopes(['read:status', 'read:status'], isSensitiveScope);
    expect(groups).toEqual([{ id: 'read', title: 'Read', scopes: ['read:status'] }]);
  });

  it('the companion offer has no sensitive group', () => {
    expect(groupScopes(COMPANION_SCOPES, isSensitiveScope).some((g) => g.id === 'sensitive')).toBe(false);
  });
});

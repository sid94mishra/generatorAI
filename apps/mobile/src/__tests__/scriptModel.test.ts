import { describe, expect, it } from 'vitest';

import { parseScriptProfiles, profileSummary } from '../features/scripts/model';

describe('profiles', () => {
  const profiles = parseScriptProfiles([
    { name: 'fast', variables: { depth: 1 }, stageOverrides: [{ stageKey: 'a', skip: true }], overrides: { permissionMode: 'acceptEdits' } },
    { name: 'plain' },
    { description: 'nameless' },
  ]);

  it('parses and summarises', () => {
    expect(profiles.map((p) => p.name)).toEqual(['fast', 'plain']);
    expect(profileSummary(profiles[0]!)).toBe('Pre-fills 1 input · skips 1 stage · permissions: acceptEdits');
    expect(profileSummary(profiles[1]!)).toBeNull();
  });

});

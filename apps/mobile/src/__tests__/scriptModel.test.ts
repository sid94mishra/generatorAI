import { describe, expect, it } from 'vitest';

import {
  applyProfileDefaults,
  parseScriptDetail,
  parseScriptProfiles,
  parseScriptRows,
  profileSummary,
  scriptRunIdOf,
  scriptSubtitle,
} from '../components/work/scriptModel';

describe('script rows', () => {
  it('parses metadata and drops id-less entries', () => {
    const rows = parseScriptRows([
      { id: 's1', name: 'Nightly', stageCount: 3, profileCount: 2, tags: ['ci', 4] },
      { name: 'no id' },
      null,
    ]);
    expect(rows).toEqual([
      { id: 's1', name: 'Nightly', description: null, stageCount: 3, profileCount: 2, tags: ['ci'] },
    ]);
    expect(scriptSubtitle(rows[0]!)).toBe('3 stages · 2 profiles');
    expect(scriptSubtitle({ stageCount: 1, profileCount: 0, description: 'x' })).toBe('1 stage · x');
    expect(parseScriptRows({})).toEqual([]);
  });
});

describe('script detail', () => {
  it('reads the nested shape the server returns', () => {
    const detail = parseScriptDetail(
      {
        metadata: { id: 's1', name: 'Nightly', stageCount: 0 },
        definition: { variables: [{ name: 'repo' }] },
        stages: [{ localId: 'plan', config: { name: 'Plan', description: 'Think' } }, { localId: 'build', config: {} }],
      },
      's1',
    );
    expect(detail?.stageCount).toBe(2);
    expect(detail?.stages).toEqual([
      { id: 'plan', name: 'Plan', description: 'Think' },
      { id: 'build', name: 'build', description: null },
    ]);
    expect(detail?.variables).toEqual([{ name: 'repo' }]);
    expect(parseScriptDetail(null, 's1')).toBeNull();
  });
});

describe('profiles', () => {
  const profiles = parseScriptProfiles([
    { name: 'fast', variables: { depth: 1 }, stageOverrides: [{ stageName: 'a', skip: true }], permissionMode: 'acceptEdits' },
    { name: 'plain' },
    { description: 'nameless' },
  ]);

  it('parses and summarises', () => {
    expect(profiles.map((p) => p.name)).toEqual(['fast', 'plain']);
    expect(profileSummary(profiles[0]!)).toBe('Pre-fills 1 input · skips 1 stage · permissions: acceptEdits');
    expect(profileSummary(profiles[1]!)).toBeNull();
  });

  it('pre-fills declared variables from the profile', () => {
    const vars = [{ name: 'depth', defaultValue: 5 }, { name: 'repo' }];
    expect(applyProfileDefaults(vars, profiles[0]!)).toEqual([{ name: 'depth', defaultValue: 1 }, { name: 'repo' }]);
    expect(applyProfileDefaults(vars, null)).toBe(vars);
  });
});

describe('scriptRunIdOf', () => {
  it('reads runId from the 202 body', () => {
    expect(scriptRunIdOf({ definitionId: 'd', runId: 'r1', status: 'running' })).toBe('r1');
    expect(scriptRunIdOf({ id: 'r2' })).toBe('r2');
    expect(scriptRunIdOf({})).toBeNull();
  });
});

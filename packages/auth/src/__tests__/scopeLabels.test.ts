// The shared scope vocabulary (`@generatorai/shared/ui-contract` scopes.ts,
// mobile MG-23) duplicates the scope ids because shared cannot import auth.
// These checks fail the moment the two drift.

import { describe, expect, it } from 'vitest';
import {
  SCOPE_LABELS,
  SCOPE_PRESETS,
  describeScope,
  isSensitiveScope,
  scopeLabel,
} from '@generatorai/shared/ui-contract';
import {
  DEFAULT_CLI_SCOPES,
  DEFAULT_DEVICE_SCOPES,
  DEFAULT_MOBILE_SCOPES,
  HIGH_RISK_SCOPES,
  SCOPES,
  STANDALONE_MOBILE_SCOPES,
} from '../scopes.js';

describe('shared scope labels (MG-23)', () => {
  it('labels exactly the scopes the server can grant', () => {
    expect(Object.keys(SCOPE_LABELS).sort()).toEqual([...SCOPES].sort());
  });

  it('never describes a scope by echoing its id', () => {
    for (const scope of SCOPES) {
      expect(scopeLabel(scope)).not.toContain(':');
      expect(describeScope(scope).length).toBeGreaterThan(10);
    }
  });

  it('derives something readable for a scope from a newer server', () => {
    expect(describeScope('read:telemetry')).toBe('See telemetry');
    expect(scopeLabel('write:secret_vault')).toBe('Change secret vault');
    expect(describeScope('nonsense')).toBe('nonsense');
  });

  it('flags every high-risk scope as sensitive, and never exec:agent', () => {
    for (const scope of HIGH_RISK_SCOPES) expect(isSensitiveScope(scope)).toBe(true);
    expect(isSensitiveScope('exec:computer')).toBe(true);
    expect(isSensitiveScope('exec:agent')).toBe(false);
    expect(isSensitiveScope('write:workflows')).toBe(false);
  });

  it('presets equal the server constants', () => {
    const byId = Object.fromEntries(SCOPE_PRESETS.map((p) => [p.id, [...p.scopes].sort()]));
    expect(byId['companion']).toEqual([...DEFAULT_MOBILE_SCOPES].sort());
    expect(byId['standalone']).toEqual([...STANDALONE_MOBILE_SCOPES].sort());
    expect(byId['device']).toEqual([...DEFAULT_DEVICE_SCOPES].sort());
    expect(byId['cli']).toEqual([...DEFAULT_CLI_SCOPES].sort());
  });
});

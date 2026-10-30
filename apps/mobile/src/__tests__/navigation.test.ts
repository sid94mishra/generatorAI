import { describe, expect, it } from 'vitest';

import { missingGrantableScopes, scopeRequestBody, scopeRequestOutcome } from '../services/auth/scopeRequests';

describe('scope requests', () => {
  it('lists only grantable scopes the device lacks, with what they unlock', () => {
    const missing = missingGrantableScopes(['read:chats', 'write:chats']);
    const scopes = missing.map((m) => m.scope);
    expect(scopes).toContain('exec:terminal');
    expect(scopes).toContain('write:workflows');
    // `write:projects` is requestable for project editing, but the structural
    // `codebaseLinkLocal` (host folder picking) never rides along with it.
    expect(missing.find((m) => m.scope === 'write:projects')?.features).toEqual(['projectEdit']);
    expect(missing.find((m) => m.scope === 'write:workflows')?.features.sort()).toEqual(
      ['runControl', 'scriptRun', 'workflowEdit'],
    );
  });

  it('builds the exact body the server route accepts', () => {
    expect(scopeRequestBody(['exec:terminal', 'exec:terminal', ''], '  tests  ')).toEqual({
      scopes: ['exec:terminal'],
      reason: 'tests',
    });
    expect(scopeRequestBody(['exec:browser'], '   ')).toEqual({ scopes: ['exec:browser'] });
    expect(scopeRequestBody([], 'why')).toBeNull();
  });

  it('maps a 404 to “server needs an update”, not to a failure', () => {
    expect(scopeRequestOutcome(201)).toEqual({ kind: 'sent' });
    expect(scopeRequestOutcome(404)).toEqual({ kind: 'unsupported' });
    expect(scopeRequestOutcome(403)).toEqual({ kind: 'forbidden' });
    expect(scopeRequestOutcome(409)).toEqual({ kind: 'pending' });
    expect(scopeRequestOutcome(500)).toEqual({ kind: 'failed', status: 500 });
  });
});

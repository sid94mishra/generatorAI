import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORK_SEGMENT,
  WORK_SEGMENTS,
  WORK_SEGMENT_PREF_KEY,
  resolveWorkSegment,
} from '../components/work/workSegment';
import { missingGrantableScopes, scopeRequestBody, scopeRequestOutcome } from '../services/auth/scopeRequests';

describe('resolveWorkSegment', () => {
  it('prefers the route param, then the stored value, then the default', () => {
    expect(resolveWorkSegment('workflows', 'runs')).toBe('workflows');
    expect(resolveWorkSegment(undefined, 'automations')).toBe('automations');
    expect(resolveWorkSegment(undefined, undefined)).toBe(DEFAULT_WORK_SEGMENT);
  });

  it('ignores anything unrecognised rather than throwing', () => {
    expect(resolveWorkSegment('nope', 'nah')).toBe(DEFAULT_WORK_SEGMENT);
    expect(resolveWorkSegment(['automations', 'runs'], undefined)).toBe('automations');
  });

  it('exposes the desktop catalogues — no Runs — and a stable pref key', () => {
    expect(WORK_SEGMENTS).toEqual(['workflows', 'scripts', 'automations']);
    expect(WORK_SEGMENT_PREF_KEY).toBe('work.segment');
  });

  it('lands an old Runs link or stored preference on Workflows, where runs now live', () => {
    expect(resolveWorkSegment('runs', undefined)).toBe('workflows');
    expect(resolveWorkSegment('runs', 'scripts')).toBe('workflows');
    expect(resolveWorkSegment(undefined, 'runs')).toBe('workflows');
    expect(DEFAULT_WORK_SEGMENT).toBe('workflows');
  });

  it('restores a phone left on the scripts segment now that it lists real scripts', () => {
    expect(resolveWorkSegment(undefined, 'scripts')).toBe('scripts');
    expect(resolveWorkSegment('scripts', 'runs')).toBe('scripts');
  });
});

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

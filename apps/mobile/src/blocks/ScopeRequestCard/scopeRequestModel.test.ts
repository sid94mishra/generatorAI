import { describe, expect, it } from 'vitest';
import type { DeviceScopeRequest } from '@generatorai/client-core';
import { agoLabel, missingScopes, requestable, scopeRequestState, scopeRows } from './scopeRequestModel';

const req = (over: Partial<DeviceScopeRequest>): DeviceScopeRequest => ({
  requestId: 'r1',
  deviceId: 'd',
  deviceName: 'Phone',
  platform: 'mobile',
  scopes: ['exec:terminal'],
  reason: null,
  status: 'pending',
  createdAt: 0,
  resolvedAt: null,
  resolvedBy: null,
  resolutionNote: null,
  grantedScopes: null,
  ...over,
});

describe('scope request state (MB-38, MDF-124)', () => {
  it('is granted once every scope is held', () => {
    expect(scopeRequestState(['read:status'], ['read:status'], [])).toEqual({ kind: 'granted' });
  });
  it('shows a pending request first, then the latest denial of these scopes', () => {
    expect(scopeRequestState(['exec:terminal'], [], [req({})]).kind).toBe('pending');
    expect(scopeRequestState(['exec:terminal'], [], [req({ status: 'denied' })]).kind).toBe('denied');
    expect(scopeRequestState(['exec:browser'], [], [req({ status: 'denied' })]).kind).toBe('not-requested');
    expect(scopeRequestState(['exec:terminal'], [], [req({ status: 'cancelled' }), req({ status: 'denied' })]).kind).toBe('denied');
    expect(scopeRequestState(['exec:terminal'], [], undefined).kind).toBe('not-requested');
  });
  it('lists missing scopes with labels, sensitivity and whether this device may ask', () => {
    expect(missingScopes(['a', 'b', 'a'], ['b'])).toEqual(['a']);
    expect(requestable('admin:settings', ['read:status'])).toBe(false);
    expect(requestable('admin:settings', ['admin:devices'])).toBe(true);
    const rows = scopeRows(['exec:terminal', 'write:workflows', 'admin:settings'], []);
    expect(rows.map((r) => [r.scope, r.sensitive, r.requestable])).toEqual([
      ['exec:terminal', true, true],
      ['write:workflows', false, true],
      ['admin:settings', true, false],
    ]);
    expect(rows[0]!.label).toBeTruthy();
  });
  it('says how long ago', () => {
    expect(agoLabel(0, 3 * 60_000)).toBe('3m');
    expect(agoLabel(0, 3 * 3_600_000)).toBe('3h');
    expect(agoLabel(0, 72 * 3_600_000)).toBe('3d');
  });
});

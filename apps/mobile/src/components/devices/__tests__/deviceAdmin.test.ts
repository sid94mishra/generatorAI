import { describe, expect, it } from 'vitest';
import { ALL_SCOPES } from '@generatorai/auth';

import { SCOPE_PRESETS } from '../../../auth/scopePresets';
import { isSensitiveScope } from '../../../auth/scopeLabels';
import {
  ALL_KNOWN_SCOPES,
  applyPreset,
  canGrantScope,
  createPairingRequest,
  diffScopes,
  editableScopeList,
  formatCountdown,
  parsePairingInvite,
  presetWithinAuthority,
  rotateDeviceRequest,
  sameScopes,
  secondsRemaining,
  sensitiveAdditions,
  setDeviceScopesRequest,
  toggleScope,
} from '../deviceAdmin';

const COMPANION = SCOPE_PRESETS.find((p) => p.id === 'companion')!;
const WORKSTATION = SCOPE_PRESETS.find((p) => p.id === 'workstation')!;

describe('scope editing rules', () => {
  it('knows every server scope', () => {
    expect([...ALL_KNOWN_SCOPES].sort()).toEqual([...ALL_SCOPES].sort());
  });

  it('diffs order-insensitively', () => {
    expect(diffScopes(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
    expect(sameScopes(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameScopes(['a'], ['a', 'b'])).toBe(false);
  });

  it('flags only ADDED sensitive scopes for step-up', () => {
    const before = ['read:chats', 'exec:terminal'];
    const after = ['read:chats', 'write:chats', 'exec:browser'];
    expect(sensitiveAdditions(before, after, isSensitiveScope)).toEqual(['exec:browser']);
    // Removing a sensitive scope never needs step-up.
    expect(sensitiveAdditions(before, ['read:chats'], isSensitiveScope)).toEqual([]);
  });

  it('never grants beyond the caller but always allows withdrawing', () => {
    const caller = ['read:chats', 'admin:devices'];
    expect(canGrantScope(caller, 'exec:terminal')).toBe(false);
    expect(toggleScope(['read:chats'], 'exec:terminal', true, caller)).toEqual(['read:chats']);
    expect(toggleScope(['read:chats'], 'admin:devices', true, caller)).toEqual(['read:chats', 'admin:devices']);
    expect(toggleScope(['exec:terminal'], 'exec:terminal', false, caller)).toEqual([]);
    expect(toggleScope(['read:chats'], 'read:chats', true, caller)).toEqual(['read:chats']);
  });

  it('applies a preset within the caller’s authority, keeping what the device already holds', () => {
    const caller = [...COMPANION.scopes, 'admin:devices'];
    const next = applyPreset(WORKSTATION, ['exec:terminal'], caller);
    expect(next).toContain('exec:terminal'); // already held
    expect(next).not.toContain('exec:browser'); // caller lacks it
    expect(next).toEqual(expect.arrayContaining([...COMPANION.scopes]));
  });

  it('only offers pairing presets the caller could grant', () => {
    expect(presetWithinAuthority(COMPANION, [...COMPANION.scopes])).toBe(true);
    expect(presetWithinAuthority(WORKSTATION, [...COMPANION.scopes])).toBe(false);
  });

  it('lists unknown scopes the device holds after the known ones', () => {
    const list = editableScopeList(['read:chats', 'future:thing']);
    expect(list[list.length - 1]).toBe('future:thing');
    expect(list).toHaveLength(ALL_KNOWN_SCOPES.length + 1);
  });
});

describe('request shapes', () => {
  it('PUTs the full de-duplicated scope list', () => {
    const req = setDeviceScopesRequest('dev/1', ['a', 'a', 'b']);
    expect(req.path).toBe('/api/auth/devices/dev%2F1/scopes');
    expect(req.init.method).toBe('PUT');
    expect(JSON.parse(req.init.body)).toEqual({ scopes: ['a', 'b'] });
  });

  it('POSTs rotation', () => {
    expect(rotateDeviceRequest('d1')).toMatchObject({ path: '/api/auth/devices/d1/rotate', init: { method: 'POST' } });
  });

  it('builds a pairing body the server schema accepts', () => {
    const body = JSON.parse(createPairingRequest({ deviceName: '  ', platform: 'mobile', ttlMs: 5 }).init.body);
    expect(body).toEqual({ deviceName: 'New device', platform: 'mobile', ttlMs: 30_000 });
    const big = JSON.parse(
      createPairingRequest({ deviceName: 'x'.repeat(80), platform: 'web', scopes: ['a', 'a'], ttlMs: 1e9 }).init.body,
    );
    expect(big.deviceName).toHaveLength(64);
    expect(big.scopes).toEqual(['a']);
    expect(big.ttlMs).toBe(600_000);
  });

  it('parses a pairing invite and rejects a malformed one', () => {
    const invite = parsePairingInvite({
      grantId: 'g',
      expiresAt: 1000,
      requestedScopes: ['read:chats', 4],
      serverId: 's',
      shortCode: 'ABCD-EFGH',
      joinUrl: 'http://host',
      pairingCode: 'code',
      pairingUrl: 'generatorai://pair?code=code',
    });
    expect(invite?.requestedScopes).toEqual(['read:chats']);
    expect(parsePairingInvite({ grantId: 'g' })).toBeNull();
    expect(parsePairingInvite(null)).toBeNull();
  });

  it('counts down without going negative', () => {
    expect(secondsRemaining(10_500, 10_000)).toBe(1);
    expect(secondsRemaining(1_000, 10_000)).toBe(0);
    expect(formatCountdown(245)).toBe('4:05');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});

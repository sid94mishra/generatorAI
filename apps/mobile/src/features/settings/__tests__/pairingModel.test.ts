import { describe, expect, it } from 'vitest';
import { SCOPE_PRESETS } from '@generatorai/shared/ui-contract';
import { formatCountdown, inviteBody, parsePairingInvite, presetById, presetName, presetWithinAuthority, secondsRemaining } from '../model/pairingModel';

describe('pairing invites (MSetPairDevice, MD-35)', () => {
  it('asks for exactly the preset, for ten minutes', () => {
    const companion = presetById('companion');
    expect(inviteBody(companion)).toMatchObject({ platform: 'mobile', scopes: [...companion.scopes], ttlMs: 600_000 });
    expect(inviteBody(presetById('cli')).deviceName).toBe('New command line');
  });

  it('reads the invite and rejects a partial one', () => {
    expect(parsePairingInvite({ grantId: 'g', shortCode: 'ABCD-EFGH-JKMN', pairingUrl: 'generatorai://pair?x', expiresAt: 5, requestedScopes: ['a', 1], joinUrl: 'http://h:3100' })).toEqual({
      grantId: 'g',
      shortCode: 'ABCD-EFGH-JKMN',
      pairingUrl: 'generatorai://pair?x',
      expiresAt: 5,
      requestedScopes: ['a'],
      joinUrl: 'http://h:3100',
    });
    expect(parsePairingInvite({ grantId: 'g' })).toBeNull();
    expect(parsePairingInvite(null)).toBeNull();
  });

  it('counts down and limits presets to the caller', () => {
    expect(secondsRemaining(10_500, 1_000)).toBe(10);
    expect(secondsRemaining(0, 1_000)).toBe(0);
    expect(formatCountdown(245)).toBe('4:05');
    const standalone = presetById('standalone');
    expect(presetWithinAuthority(standalone, presetById('companion').scopes)).toBe(false);
    expect(presetWithinAuthority(standalone, standalone.scopes)).toBe(true);
  });

  it('names a scope set by its preset', () => {
    expect(presetName(SCOPE_PRESETS[0]!.scopes)).toBe(SCOPE_PRESETS[0]!.label);
    expect(presetName(['read:status'])).toBe('Custom');
  });
});

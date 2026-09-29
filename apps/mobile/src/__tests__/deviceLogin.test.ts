import { describe, expect, it } from 'vitest';

import {
  countdown,
  deviceConnectAvailability,
  expiresAtMs,
  interpretDeviceStatus,
  isNotConfiguredError,
  pollDelayMs,
} from '../components/scm/deviceLogin';

const github = (loginMethods: Array<'token' | 'device' | 'gh-cli'>) => [
  { id: 'github' as const, name: 'GitHub', loginMethods },
];

describe('device sign-in availability', () => {
  it('asks for the scope before anything else', () => {
    expect(deviceConnectAvailability(github(['token']), ['read:projects']).kind).toBe('missing-scope');
  });

  it('explains a server without an OAuth client id', () => {
    const result = deviceConnectAvailability(github(['token', 'gh-cli']), ['write:projects']);
    expect(result.kind).toBe('not-configured');
    expect(result.kind === 'not-configured' && result.reason).toMatch(/OAuth app/);
  });

  it('is available when the server offers the device method', () => {
    expect(deviceConnectAvailability(github(['token', 'device']), ['write:projects'])).toEqual({ kind: 'available' });
  });

  it('waits for the provider list before deciding', () => {
    expect(deviceConnectAvailability(undefined, ['write:projects'])).toEqual({ kind: 'unknown' });
  });

  it('recognises the server not-configured error', () => {
    expect(
      isNotConfiguredError('Device sign-in is not configured on this server (GENERATORAI_GITHUB_OAUTH_CLIENT_ID is unset).'),
    ).toBe(true);
    expect(isNotConfiguredError('GitHub is down')).toBe(false);
  });
});

describe('device sign-in polling', () => {
  it('bounds the poll delay', () => {
    expect(pollDelayMs(5)).toBe(5000);
    expect(pollDelayMs(0)).toBe(2000);
    expect(pollDelayMs(900)).toBe(30000);
    expect(pollDelayMs(undefined)).toBe(5000);
  });

  it('counts down to zero', () => {
    const expires = expiresAtMs(0, 90);
    expect(countdown(expires, 0)).toBe('1:30');
    expect(countdown(expires, 89_500)).toBe('0:01');
    expect(countdown(expires, 200_000)).toBe('0:00');
  });

  it('maps poll responses to phases', () => {
    const later = 10_000;
    expect(interpretDeviceStatus({ loginId: 'l', status: 'pending' }, 0, later)).toEqual({ kind: 'waiting' });
    expect(interpretDeviceStatus({ loginId: 'l', status: 'pending' }, later, later)).toEqual({ kind: 'expired' });
    expect(interpretDeviceStatus({ loginId: 'l', status: 'expired' }, 0, later)).toEqual({ kind: 'expired' });
    expect(interpretDeviceStatus({ loginId: 'l', status: 'error', error: 'Sign-in was denied.' }, 0, later)).toEqual({
      kind: 'failed',
      message: 'Sign-in was denied.',
    });
    expect(
      interpretDeviceStatus(
        {
          loginId: 'l',
          status: 'complete',
          account: { id: 'a', provider: 'github', label: 'octo @ github.com', login: 'octo', authMethod: 'device', createdAt: '' },
        },
        later,
        later,
      ),
    ).toEqual({ kind: 'connected', label: 'octo' });
  });
});


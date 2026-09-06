// The status bar and the launch toast are the only two places the TUI says
// whether it can talk to a server. Both used to collapse "unreachable" and
// "reachable but unpaired" into one yellow line with no reason attached.

import { describe, expect, it } from 'vitest';
import { connectionToast, connectionTone } from '../connectionStatus.js';

describe('connectionTone', () => {
  it('is green only when authenticated', () => {
    expect(connectionTone('authenticated')).toBe('success');
  });

  it('is yellow for unpaired — the server answered, the device just is not enrolled', () => {
    expect(connectionTone('unpaired')).toBe('warning');
  });

  it('is red for a hard error and for no connection at all', () => {
    // Reverting to the old `authenticated ? success : warning` makes these
    // indistinguishable from `unpaired`.
    expect(connectionTone('error')).toBe('failure');
    expect(connectionTone(null)).toBe('failure');
    expect(connectionTone(undefined)).toBe('failure');
  });
});

describe('connectionToast', () => {
  it('says nothing when authenticated', () => {
    expect(connectionToast({ status: 'authenticated' }, '127.0.0.1:3100')).toBeNull();
  });

  it('tells an unpaired user the exact command to run', () => {
    const toast = connectionToast({ status: 'unpaired' }, '127.0.0.1:3100');
    expect(toast?.tone).toBe('warning');
    expect(toast?.text).toContain('generatorai device pair');
  });

  it('surfaces the real reason for a hard failure, as an error', () => {
    const toast = connectionToast(
      { status: 'error', message: 'connect ECONNREFUSED 127.0.0.1:3100' },
      '127.0.0.1:3100',
    );
    expect(toast?.tone).toBe('error');
    expect(toast?.text).toBe('Cannot reach 127.0.0.1:3100: connect ECONNREFUSED 127.0.0.1:3100');
    // The old behaviour — the thing this pins against.
    expect(toast?.text).not.toBe('Auth: error');
  });

  it('still names the host when the runtime gave no message', () => {
    expect(connectionToast({ status: 'error' }, 'studio.example')?.text).toBe(
      'Cannot reach studio.example',
    );
  });

  it('keeps any other state visible with its detail attached', () => {
    const toast = connectionToast({ status: 'revoked', message: 'device revoked by admin' }, 'h');
    expect(toast?.tone).toBe('warning');
    expect(toast?.text).toBe('Auth: revoked — device revoked by admin');
  });
});

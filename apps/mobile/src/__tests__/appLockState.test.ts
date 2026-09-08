import { describe, expect, it } from 'vitest';

import {
  appLockReducer,
  describeFailure,
  graceExpired,
  initialAppLockState,
  isRetryableFailure,
  shouldCoverContent,
  shouldPromptAuth,
  shouldShowPrivacyOverlay,
  type AppLockState,
} from '../auth/appLockState';

const T0 = 1_000_000;

function unlocked(overrides: Partial<AppLockState> = {}): AppLockState {
  return {
    ...initialAppLockState({ enabled: true, graceSeconds: 60 }),
    phase: 'unlocked',
    ...overrides,
  };
}

describe('app lock — cold start', () => {
  it('starts locked when the preference is on', () => {
    const state = initialAppLockState({ enabled: true, graceSeconds: 60 });
    expect(state.phase).toBe('locked');
    expect(shouldPromptAuth(state)).toBe(true);
    expect(shouldCoverContent(state)).toBe(true);
  });

  it('starts unlocked and never prompts when the preference is off', () => {
    const state = initialAppLockState({ enabled: false, graceSeconds: 60 });
    expect(state.phase).toBe('unlocked');
    expect(shouldPromptAuth(state)).toBe(false);
    expect(shouldCoverContent(state)).toBe(false);
    const away = appLockReducer(state, { type: 'appState', next: 'background', now: T0 });
    expect(shouldShowPrivacyOverlay(away)).toBe(false);
  });

  it('does not prompt while the app is not in the foreground', () => {
    const state = initialAppLockState({ enabled: true, graceSeconds: 60, appState: 'background' });
    expect(shouldPromptAuth(state)).toBe(false);
    expect(shouldShowPrivacyOverlay(state)).toBe(true);
  });
});

describe('app lock — authentication', () => {
  it('unlocks on success and re-locks on a retryable failure', () => {
    let state = initialAppLockState({ enabled: true, graceSeconds: 60 });
    state = appLockReducer(state, { type: 'authStart' });
    expect(state.phase).toBe('authenticating');
    expect(shouldPromptAuth(state)).toBe(false);

    const failed = appLockReducer(state, { type: 'authFailed', failure: 'user_cancel' });
    expect(failed.phase).toBe('locked');
    expect(failed.failure).toBe('user_cancel');
    expect(isRetryableFailure(failed.failure)).toBe(true);

    const ok = appLockReducer(state, { type: 'authSucceeded' });
    expect(ok.phase).toBe('unlocked');
    expect(ok.failure).toBeNull();
    expect(shouldCoverContent(ok)).toBe(false);
  });

  it('lets the user in and disables the lock when the device has nothing to check', () => {
    for (const failure of ['not_enrolled', 'passcode_not_set', 'not_available'] as const) {
      let state = initialAppLockState({ enabled: true, graceSeconds: 60 });
      state = appLockReducer(state, { type: 'authStart' });
      state = appLockReducer(state, { type: 'authFailed', failure });
      expect(state.phase, failure).toBe('unlocked');
      expect(state.enabled, failure).toBe(false);
      expect(isRetryableFailure(failure)).toBe(false);
      expect(describeFailure(failure)).toMatch(/turned off/);
    }
  });

  it('ignores authStart unless locked', () => {
    const state = unlocked();
    expect(appLockReducer(state, { type: 'authStart' })).toBe(state);
  });
});

describe('app lock — background grace', () => {
  it('re-locks after an absence longer than the grace', () => {
    let state = unlocked();
    state = appLockReducer(state, { type: 'appState', next: 'inactive', now: T0 });
    state = appLockReducer(state, { type: 'appState', next: 'background', now: T0 + 100 });
    expect(shouldShowPrivacyOverlay(state)).toBe(true);
    expect(shouldCoverContent(state)).toBe(true);

    const back = appLockReducer(state, { type: 'appState', next: 'active', now: T0 + 61_000 });
    expect(back.phase).toBe('locked');
    expect(shouldPromptAuth(back)).toBe(true);
    expect(back.leftForegroundAt).toBeNull();
  });

  it('stays unlocked after an absence shorter than the grace', () => {
    let state = unlocked();
    state = appLockReducer(state, { type: 'appState', next: 'background', now: T0 });
    const back = appLockReducer(state, { type: 'appState', next: 'active', now: T0 + 30_000 });
    expect(back.phase).toBe('unlocked');
    expect(shouldCoverContent(back)).toBe(false);
  });

  it('measures from the FIRST departure, not from reaching background', () => {
    let state = unlocked();
    state = appLockReducer(state, { type: 'appState', next: 'inactive', now: T0 });
    state = appLockReducer(state, { type: 'appState', next: 'background', now: T0 + 59_000 });
    const back = appLockReducer(state, { type: 'appState', next: 'active', now: T0 + 60_000 });
    expect(back.phase).toBe('locked');
  });

  it('"immediately" locks after a real background but not after an inactive blip', () => {
    const base = unlocked({ graceSeconds: 0 });

    let blip = appLockReducer(base, { type: 'appState', next: 'inactive', now: T0 });
    blip = appLockReducer(blip, { type: 'appState', next: 'active', now: T0 + 5_000 });
    expect(blip.phase).toBe('unlocked');

    let away = appLockReducer(base, { type: 'appState', next: 'background', now: T0 });
    away = appLockReducer(away, { type: 'appState', next: 'active', now: T0 + 1 });
    expect(away.phase).toBe('locked');
  });

  it('the system prompt’s own inactive transition never re-locks a fresh unlock', () => {
    let state = initialAppLockState({ enabled: true, graceSeconds: 0 });
    state = appLockReducer(state, { type: 'authStart' });
    // The Face ID sheet takes the app to inactive (and on some devices to
    // background) while authenticating.
    state = appLockReducer(state, { type: 'appState', next: 'inactive', now: T0 });
    state = appLockReducer(state, { type: 'appState', next: 'background', now: T0 + 10 });
    expect(state.leftForegroundAt).toBeNull();
    state = appLockReducer(state, { type: 'authSucceeded' });
    state = appLockReducer(state, { type: 'appState', next: 'active', now: T0 + 500 });
    expect(state.phase).toBe('unlocked');
  });

  it('fails closed when the clock goes backwards', () => {
    expect(graceExpired({ graceSeconds: 60, leftForegroundAt: T0, reachedBackground: true }, T0 - 5)).toBe(
      true,
    );
  });

  it('honours a grace changed while away', () => {
    let state = unlocked();
    state = appLockReducer(state, { type: 'appState', next: 'background', now: T0 });
    state = appLockReducer(state, { type: 'setGrace', seconds: 900 });
    const back = appLockReducer(state, { type: 'appState', next: 'active', now: T0 + 120_000 });
    expect(back.phase).toBe('unlocked');
  });
});

describe('app lock — preference changes', () => {
  it('turning the lock off unlocks immediately', () => {
    const state = initialAppLockState({ enabled: true, graceSeconds: 60 });
    const off = appLockReducer(state, { type: 'setEnabled', enabled: false });
    expect(off.phase).toBe('unlocked');
    expect(shouldCoverContent(off)).toBe(false);
  });

  it('turning the lock on does not lock the user who just turned it on', () => {
    const state = initialAppLockState({ enabled: false, graceSeconds: 60 });
    const on = appLockReducer(state, { type: 'setEnabled', enabled: true });
    expect(on.enabled).toBe(true);
    expect(on.phase).toBe('unlocked');
    // …but the next long absence locks.
    let away = appLockReducer(on, { type: 'appState', next: 'background', now: T0 });
    away = appLockReducer(away, { type: 'appState', next: 'active', now: T0 + 3_600_000 });
    expect(away.phase).toBe('locked');
  });

  it('lockNow is a no-op when disabled and locks when enabled', () => {
    const off = initialAppLockState({ enabled: false, graceSeconds: 60 });
    expect(appLockReducer(off, { type: 'lockNow' })).toBe(off);
    const on = unlocked();
    expect(appLockReducer(on, { type: 'lockNow' }).phase).toBe('locked');
  });

  it('returns the same object for a no-op event', () => {
    const state = unlocked();
    expect(appLockReducer(state, { type: 'setEnabled', enabled: true })).toBe(state);
    expect(appLockReducer(state, { type: 'appState', next: 'active', now: T0 })).toBe(state);
  });
});

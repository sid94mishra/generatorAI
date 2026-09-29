// ────────────────────────────────────────────────────────────────
// App lock — pure state machine.
//
// Everything that decides WHEN the lock screen shows lives here, with no
// React, no AppState and no expo-local-authentication, so the rules are
// unit-testable and the component (`AppLock.tsx`) is only wiring.
//
// The rules:
//
//   • Cold start with the preference on  → locked until authenticated.
//   • Leaving the foreground records when. Coming back re-locks only when
//     the app was away for at least the grace period. "Immediately" (0s)
//     re-locks after a genuine background, not after an `inactive` blip —
//     the notification shade, Control Centre and the system biometric
//     prompt itself all pass through `inactive` and would otherwise lock
//     the app the moment it finished unlocking.
//   • The system prompt's own `inactive` transition never starts the grace
//     timer, because it happens while the phase is `authenticating`, not
//     `unlocked`.
//   • Turning the preference off unlocks; turning it on does not lock (the
//     user is demonstrably present).
//   • The privacy overlay covers content whenever the lock is enabled and
//     the app is not `active`, so the task switcher never shows a transcript.
// ────────────────────────────────────────────────────────────────

/** RN's `AppStateStatus`, retyped so this file has no react-native import. */
export type AppStateName = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export type LockPhase = 'unlocked' | 'locked' | 'authenticating';

/** Why the last attempt failed, in expo-local-authentication's vocabulary. */
export type LockFailure =
  | 'not_enrolled'
  | 'user_cancel'
  | 'app_cancel'
  | 'not_available'
  | 'lockout'
  | 'no_space'
  | 'timeout'
  | 'unable_to_process'
  | 'unknown'
  | 'system_cancel'
  | 'user_fallback'
  | 'invalid_context'
  | 'passcode_not_set'
  | 'authentication_failed';

/** Failures that mean the device has nothing to authenticate WITH. */
export const UNLOCKABLE_FAILURES: ReadonlySet<LockFailure> = new Set<LockFailure>([
  'not_enrolled',
  'not_available',
  'passcode_not_set',
]);

export interface AppLockState {
  enabled: boolean;
  graceSeconds: number;
  phase: LockPhase;
  appState: AppStateName;
  /** When the app last left `active` while unlocked, or null. */
  leftForegroundAt: number | null;
  /** Whether that absence reached `background` (not just `inactive`). */
  reachedBackground: boolean;
  failure: LockFailure | null;
}

export type AppLockEvent =
  | { type: 'appState'; next: AppStateName; now: number }
  | { type: 'authStart' }
  | { type: 'authSucceeded' }
  | { type: 'authFailed'; failure: LockFailure }
  | { type: 'setEnabled'; enabled: boolean }
  | { type: 'setGrace'; seconds: number }
  | { type: 'lockNow' };

export function initialAppLockState(input: {
  enabled: boolean;
  graceSeconds: number;
  appState?: AppStateName;
}): AppLockState {
  return {
    enabled: input.enabled,
    graceSeconds: Math.max(0, input.graceSeconds),
    phase: input.enabled ? 'locked' : 'unlocked',
    appState: input.appState ?? 'active',
    leftForegroundAt: null,
    reachedBackground: false,
    failure: null,
  };
}

/** Pure: has an absence that began at `leftAt` outlasted the grace? */
export function graceExpired(
  state: Pick<AppLockState, 'graceSeconds' | 'leftForegroundAt' | 'reachedBackground'>,
  now: number,
): boolean {
  if (state.leftForegroundAt === null) return false;
  if (state.graceSeconds === 0) return state.reachedBackground;
  const elapsed = now - state.leftForegroundAt;
  // A clock step backwards makes `elapsed` negative; failing closed there
  // (locking) is the safer error for a lock screen.
  return elapsed < 0 || elapsed >= state.graceSeconds * 1000;
}

export function appLockReducer(state: AppLockState, event: AppLockEvent): AppLockState {
  switch (event.type) {
    case 'appState': {
      const wasActive = state.appState === 'active';
      const isActive = event.next === 'active';

      if (wasActive && !isActive) {
        // Only an UNLOCKED app starts the timer. A locked app is locked
        // whatever happens; an authenticating app is behind the OS prompt.
        if (state.phase !== 'unlocked') return { ...state, appState: event.next };
        return {
          ...state,
          appState: event.next,
          leftForegroundAt: event.now,
          reachedBackground: event.next === 'background',
        };
      }

      if (!wasActive && !isActive) {
        // inactive → background: the absence became real.
        return {
          ...state,
          appState: event.next,
          reachedBackground: state.reachedBackground || event.next === 'background',
        };
      }

      if (!wasActive && isActive) {
        const relock = state.enabled && state.phase === 'unlocked' && graceExpired(state, event.now);
        return {
          ...state,
          appState: 'active',
          leftForegroundAt: null,
          reachedBackground: false,
          phase: relock ? 'locked' : state.phase,
          failure: relock ? null : state.failure,
        };
      }

      return state.appState === event.next ? state : { ...state, appState: event.next };
    }

    case 'authStart':
      if (state.phase !== 'locked') return state;
      return { ...state, phase: 'authenticating', failure: null };

    case 'authSucceeded':
      return { ...state, phase: 'unlocked', failure: null, leftForegroundAt: null, reachedBackground: false };

    case 'authFailed':
      // Nothing on the device can satisfy the lock: let the user in rather
      // than bricking the app. The component turns the preference off and
      // explains why.
      if (UNLOCKABLE_FAILURES.has(event.failure)) {
        return { ...state, enabled: false, phase: 'unlocked', failure: event.failure };
      }
      return { ...state, phase: 'locked', failure: event.failure };

    case 'setEnabled':
      if (event.enabled === state.enabled) return state;
      return event.enabled
        ? { ...state, enabled: true, failure: null }
        : { ...state, enabled: false, phase: 'unlocked', failure: null, leftForegroundAt: null, reachedBackground: false };

    case 'setGrace':
      return { ...state, graceSeconds: Math.max(0, event.seconds) };

    case 'lockNow':
      if (!state.enabled) return state;
      return { ...state, phase: 'locked', failure: null };

    default:
      return state;
  }
}

// ── Selectors ───────────────────────────────────────────────────

/** The component should fire the system prompt now. */
export function shouldPromptAuth(state: AppLockState): boolean {
  return state.enabled && state.phase === 'locked' && state.appState === 'active';
}

/** Content must be covered: locked, or backgrounded with the lock on. */
export function shouldCoverContent(state: AppLockState): boolean {
  if (!state.enabled) return false;
  return state.phase !== 'unlocked' || state.appState !== 'active';
}

/** The opaque privacy overlay (no controls) rather than the lock screen. */
export function shouldShowPrivacyOverlay(state: AppLockState): boolean {
  return state.enabled && state.appState !== 'active';
}

/** A failure the user can act on by tapping "Unlock" again. */
export function isRetryableFailure(failure: LockFailure | null): boolean {
  if (!failure) return false;
  return !UNLOCKABLE_FAILURES.has(failure);
}

export function describeFailure(failure: LockFailure): string {
  switch (failure) {
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
      return 'Unlock was cancelled.';
    case 'lockout':
      return 'Too many attempts. Unlock your phone with its passcode, then try again.';
    case 'authentication_failed':
      return 'That did not match. Try again.';
    case 'not_enrolled':
      return 'No Face ID, Touch ID or fingerprint is set up on this phone, so app lock has been turned off.';
    case 'passcode_not_set':
      return 'This phone has no passcode, so there is nothing to lock with. App lock has been turned off.';
    case 'not_available':
      return 'Biometric unlock is not available on this device, so app lock has been turned off.';
    case 'timeout':
      return 'Unlock timed out.';
    default:
      return 'Could not unlock. Try again.';
  }
}

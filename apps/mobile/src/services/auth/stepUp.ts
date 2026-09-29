// ────────────────────────────────────────────────────────────────
// Biometric step-up — prove presence before the first risky action.
//
// Plan §5.1: on the phone, `exec:*` and `admin:*` actions get a LOCAL
// biometric step-up before the first use in a session. The scope grant is
// still what authorises the action on the server; this only stops a phone
// left unlocked on a desk from being used to open a shell with two taps.
//
// ── API ─────────────────────────────────────────────────────────
//
//   requireStepUp(reason: string): Promise<boolean>
//
//     Call BEFORE the first use per session of any of:
//       • an `exec:terminal` action   (opening a terminal, running a command)
//       • an `exec:browser` action    (driving the browser pane)
//       • an `exec:computer` action   (computer use)
//       • any `admin:*` action        (settings writes, device management)
//       • revoking a device           (Settings → Security)
//
//     `reason` is the sentence the OS prompt shows, e.g.
//     "Confirm opening a terminal on your Mac". Returns true when the user
//     authenticated — or already did within the last STEP_UP_WINDOW_MS —
//     and false when they cancelled or failed. Callers MUST bail out on
//     false without performing the action.
//
//     Concurrent calls share one prompt; a success caches for ten minutes
//     of module lifetime (a fresh process starts cold). Unpairing resets it
//     (`resetStepUp`, called from AuthProvider).
//
//     Devices with no biometrics fall back to the device passcode. A device
//     with NEITHER (no passcode set) cannot be stepped up at all; the call
//     resolves true and logs, because refusing every exec action on such a
//     phone would make the scope grant meaningless, and the server-side
//     grant is the actual authorisation.
//
//     Web preview: resolves true with a console note — there is no sensor.
//
//   useStepUp(): { requireStepUp, isFresh, reset }
//
//     Hook form for screens. `isFresh` lets a screen show a "confirmed"
//     chip instead of prompting again.
//
// Callers (terminal/browser/computer surfaces, security screen) are wired
// by their owners; nothing here is invoked yet.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import { isStepUpFresh } from './stepUpRules';

export { STEP_UP_WINDOW_MS, isStepUpFresh } from './stepUpRules';

interface StepUpSession {
  lastSuccessAt: number | null;
  inFlight: Promise<boolean> | null;
}

const session: StepUpSession = { lastSuccessAt: null, inFlight: null };

/** Whether the cached step-up is still valid right now. */
export function hasFreshStepUp(now: number = Date.now()): boolean {
  return isStepUpFresh(session.lastSuccessAt, now);
}

/** Forget the cached success. Called on unpair and revoke. */
export function resetStepUp(): void {
  session.lastSuccessAt = null;
}

/** Test-only: reset every piece of module state. */
export function _resetStepUpForTests(): void {
  session.lastSuccessAt = null;
  session.inFlight = null;
}

/** Errors that mean the device has nothing to check the user against. */
const NOTHING_TO_CHECK = new Set<LocalAuthentication.LocalAuthenticationError>([
  'not_enrolled',
  'not_available',
  'passcode_not_set',
]);

async function promptOnce(reason: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-console -- web preview has no sensor; say so rather than silently pass
    console.info(`[stepUp] web preview: auto-approving "${reason}"`);
    return true;
  }

  let result: LocalAuthentication.LocalAuthenticationResult;
  try {
    result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      // Passcode is an acceptable second factor; refusing it would lock out
      // every phone without a sensor instead of gating them.
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
  } catch (err) {
    // A thrown error (not a `success: false`) is the module being unusable —
    // treat it like a cancel, never like a pass.
    // eslint-disable-next-line no-console -- surfaced for diagnostics; the caller only sees `false`
    console.warn('[stepUp] authenticateAsync threw', err);
    return false;
  }

  if (result.success) return true;

  if (NOTHING_TO_CHECK.has(result.error)) {
    // eslint-disable-next-line no-console -- an honest note that the gate could not run
    console.warn(`[stepUp] no local credential to step up with (${result.error}); allowing`);
    return true;
  }
  return false;
}

export async function requireStepUp(reason: string): Promise<boolean> {
  const now = Date.now();
  if (isStepUpFresh(session.lastSuccessAt, now)) return true;

  // Two screens asking at once (a terminal pane and its command runner)
  // must not stack two Face ID prompts.
  if (session.inFlight) return session.inFlight;

  const attempt = promptOnce(reason)
    .then((ok) => {
      if (ok) session.lastSuccessAt = Date.now();
      return ok;
    })
    .finally(() => {
      session.inFlight = null;
    });
  session.inFlight = attempt;
  return attempt;
}

export interface StepUpApi {
  requireStepUp: (reason: string) => Promise<boolean>;
  /** Whether a recent success already covers the next action. */
  isFresh: () => boolean;
  reset: () => void;
}

export function useStepUp(): StepUpApi {
  const require = useCallback((reason: string) => requireStepUp(reason), []);
  const isFresh = useCallback(() => hasFreshStepUp(), []);
  const reset = useCallback(() => resetStepUp(), []);
  return useMemo(() => ({ requireStepUp: require, isFresh, reset }), [require, isFresh, reset]);
}

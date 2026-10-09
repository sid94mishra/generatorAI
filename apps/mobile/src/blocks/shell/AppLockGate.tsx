// AppLockGate — the biometric app lock and the privacy overlay (MSetAppLock, MX-10, 06 §6.2; on the kit since M10-01).
//
// Wraps the navigator (app/_layout.tsx). Children stay MOUNTED while locked: tearing the tree down on every background
// would drop the stream socket, the navigation state and every in-flight query, and the point of a lock is to hide
// content, not to reset the app. An opaque layer covers the tree, which is hidden from assistive tech so VoiceOver
// cannot read a transcript through the lock.
//
//   Privacy overlay — while the app is `inactive` / `background` (and "Hide in app switcher" or the lock is on), so
//                     the task-switcher snapshot is the app mark, never a chat.
//   Lock screen     — after a cold start or an absence longer than the grace, until `expo-local-authentication`
//                     succeeds. Falls back to the device passcode.
//
// The rules (when to lock, what a failure means) are `services/auth/appLockState.ts`; this file wires AppState, the
// preference and the OS prompt to them. The browser preview has no sensor: there it renders the children only.
import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState, View, type AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import {
  appLockReducer,
  describeFailure,
  initialAppLockState,
  isRetryableFailure,
  shouldCoverContent,
  shouldPromptAuth,
  shouldShowPrivacyOverlay,
  type AppStateName,
  type LockFailure,
} from '../../services/auth/appLockState';
import { resetStepUp } from '../../services/auth/stepUp';
import { stepUpExpiredByAbsence } from '../../services/auth/stepUpRules';
import { setAppSwitcherPrivacy, setNotificationPreviewRedaction } from '../../services/native/privacy';
import { IS_NATIVE_RUNTIME } from '../../services/native/runtimeOs';
import { readLockPreferences, usePreferences } from '../../services/prefs/preferences';
import { nouns } from '../../ui/platform/nouns';
import { BrandMark } from '../../ui/primitives/BrandMark';
import { Button } from '../../ui/primitives/Button';
import { Icon } from '../../ui/primitives/Icon';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';

/**
 * Whether the device can satisfy the lock at all. `authenticateAsync` with the device fallback succeeds with just a
 * passcode, so the only unlockable state is "no passcode either"; reported as a `LockFailure` for the reducer.
 */
async function probeCredential(): Promise<LockFailure | null> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level === LocalAuthentication.SecurityLevel.NONE ? 'passcode_not_set' : null;
  } catch {
    // The probe failing is not the same as the device lacking a credential; the real prompt decides.
    return null;
  }
}

export function AppLockGate({ children }: { children: React.ReactNode }): React.ReactElement {
  if (!IS_NATIVE_RUNTIME) return <>{children}</>;
  return <NativeAppLockGate>{children}</NativeAppLockGate>;
}

function NativeAppLockGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { biometricLock, lockGraceSeconds, setBiometricLock, hideInSwitcher, hideNotificationPreviews } = usePreferences();

  const [state, dispatch] = useReducer(appLockReducer, undefined, () => {
    // Read synchronously so the first frame is already covered when the preference is on.
    const stored = readLockPreferences();
    return initialAppLockState({
      enabled: stored.biometricLock,
      graceSeconds: stored.lockGraceSeconds,
      appState: (AppState.currentState ?? 'active') as AppStateName,
    });
  });

  // The iOS notification service extension reads this flag (MD-92): previews hide while App lock is on, or when chosen.
  const redactPreviews = biometricLock || hideNotificationPreviews;
  useEffect(() => {
    setNotificationPreviewRedaction(redactPreviews);
  }, [redactPreviews]);

  // App switcher / Recents (MX-10, 06 §6.2): native protection under the JS overlay below, with the lock always.
  const hideSwitcher = biometricLock || hideInSwitcher;
  useEffect(() => {
    setAppSwitcherPrivacy(hideSwitcher);
  }, [hideSwitcher]);

  // Step-up cache (06 §6.4): an absence longer than the lock grace forgets the 10-minute step-up.
  const leftAt = useRef<number | null>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') leftAt.current ??= Date.now();
      else if (next === 'active') {
        if (stepUpExpiredByAbsence(leftAt.current, Date.now(), readLockPreferences().lockGraceSeconds)) resetStepUp();
        leftAt.current = null;
      }
    });
    return () => subscription.remove();
  }, []);

  // Preference changes flow into the machine; the machine never writes the preference back except in the "nothing to
  // lock with" case below.
  useEffect(() => {
    dispatch({ type: 'setEnabled', enabled: biometricLock });
  }, [biometricLock]);
  useEffect(() => {
    dispatch({ type: 'setGrace', seconds: lockGraceSeconds });
  }, [lockGraceSeconds]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      dispatch({ type: 'appState', next: next as AppStateName, now: Date.now() });
    });
    return () => subscription.remove();
  }, []);

  // One prompt at a time: iOS returns `app_cancel` for a second `authenticateAsync` while the first sheet is up.
  const promptingRef = useRef(false);
  const authenticate = useCallback(async () => {
    if (promptingRef.current) return;
    promptingRef.current = true;
    dispatch({ type: 'authStart' });
    try {
      const missing = await probeCredential();
      if (missing) {
        dispatch({ type: 'authFailed', failure: missing });
        return;
      }
      // Passcode is fine: the lock is about presence, not biometrics, and a phone without a sensor deserves one too.
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock GeneratorAI', cancelLabel: 'Cancel', disableDeviceFallback: false });
      if (result.success) dispatch({ type: 'authSucceeded' });
      else dispatch({ type: 'authFailed', failure: result.error });
    } catch {
      dispatch({ type: 'authFailed', failure: 'unknown' });
    } finally {
      promptingRef.current = false;
    }
  }, []);

  // Prompt whenever the machine says so: cold start, and every return from the background past the grace. Not on a
  // retryable failure — the user taps Unlock for that, otherwise a cancel loops straight back into the sheet.
  const prompt = shouldPromptAuth(state);
  const failure = state.failure;
  useEffect(() => {
    if (prompt && !failure) void authenticate();
  }, [prompt, failure, authenticate]);

  // "Nothing to lock with": the reducer already unlocked; persist the decision and explain it once.
  useEffect(() => {
    if (failure && !isRetryableFailure(failure) && biometricLock) {
      setBiometricLock(false);
      toast({ kind: 'error', message: describeFailure(failure) });
    }
  }, [failure, biometricLock, setBiometricLock]);

  const cover = shouldCoverContent(state, hideInSwitcher);
  const privacyOnly = shouldShowPrivacyOverlay(state, hideInSwitcher);

  return (
    <View className="flex-1">
      <View className="flex-1" accessibilityElementsHidden={cover} importantForAccessibility={cover ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      {cover ? (
        <View
          className="absolute inset-0 items-center justify-center bg-surface px-8"
          accessibilityViewIsModal
          // Anything the user could reach behind this layer would be a leak.
          pointerEvents="auto"
          testID={privacyOnly ? 'privacy-overlay' : 'app-lock'}
        >
          {privacyOnly ? <AppMark /> : <LockScreen failure={failure} authenticating={state.phase === 'authenticating'} onUnlock={() => void authenticate()} />}
        </View>
      ) : null}
    </View>
  );
}

/** The app mark, the same one the splash shows. */
function AppMark(): React.ReactElement {
  return (
    <View accessibilityRole="text" className="items-center gap-3" accessible accessibilityLabel="GeneratorAI">
      <BrandMark mark="app" size={36} />
      <Text role="headline" weight={600}>
        GeneratorAI
      </Text>
    </View>
  );
}

function LockScreen({ failure, authenticating, onUnlock }: { failure: LockFailure | null; authenticating: boolean; onUnlock: () => void }): React.ReactElement {
  const n = nouns();
  const body = authenticating ? 'Confirm it is you to continue.' : failure ? describeFailure(failure) : `Unlock with ${n.biometric} or your passcode.`;
  return (
    <View className="w-full max-w-sm items-center gap-6">
      <View className="size-16 items-center justify-center rounded-card-lg bg-sunken">
        <Icon concept={authenticating ? 'scan' : 'lock'} size={24} tone="accent" />
      </View>
      <View className="items-center gap-1">
        <Text role="title" weight={600} accessibilityRole="header" align="center">
          GeneratorAI is locked
        </Text>
        <Text role="subhead" tone="fg-2" align="center">
          {body}
        </Text>
      </View>
      <Button label="Unlock" variant="primary" size="lg" fullWidth onPress={onUnlock} disabled={authenticating} loading={authenticating} />
      <Text role="footnote" tone="fg-3" align="center">
        Turn app lock off in Settings › App lock & privacy.
      </Text>
    </View>
  );
}

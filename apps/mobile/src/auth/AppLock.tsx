// ────────────────────────────────────────────────────────────────
// AppLockGate — biometric app lock and privacy overlay.
//
// Wraps the navigator (see app/_layout.tsx). Children stay MOUNTED while
// locked: tearing the tree down on every background would drop the stream
// socket, the navigation state and every in-flight query, and the point of
// a lock is to hide content, not to reset the app. Instead an opaque layer
// covers the tree, and the tree is hidden from assistive tech so VoiceOver
// cannot read a transcript through the lock.
//
// Two layers, both on `bg-background`:
//
//   Privacy overlay  — while the app is `inactive`/`background`, so the
//                      task-switcher snapshot is the app mark, never a chat.
//   Lock screen      — after a cold start or an absence longer than the
//                      grace, until `expo-local-authentication` succeeds.
//                      Falls back to the device passcode.
//
// The rules (when to lock, what a failure means) are in `appLockState.ts`;
// this file only wires AppState, the preference and the OS prompt to them.
//
// Web preview: renders children and nothing else — a browser has no
// sensor and `expo start --web` exists to review layouts, not locks.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState, Platform, Text, View, type AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Lock, ScanFace, Sparkles } from 'lucide-react-native';

import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { useTheme } from '../theme/ThemeProvider';
import { readLockPreferences, usePreferences } from '../prefs/preferences';
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
} from './appLockState';

let warnedWeb = false;

/**
 * Check the device can satisfy the lock at all.
 *
 * `authenticateAsync` with device fallback on already succeeds with just a
 * passcode, so the only truly unlockable state is "no passcode either".
 * Reported as a `LockFailure` so the reducer applies its own rule.
 */
async function probeCredential(): Promise<LockFailure | null> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return 'passcode_not_set';
    return null;
  } catch {
    // The probe failing is not the same as the device lacking a credential;
    // let the real prompt decide.
    return null;
  }
}

export function AppLockGate({ children }: { children: React.ReactNode }): React.ReactElement {
  if (Platform.OS === 'web') {
    if (!warnedWeb) {
      warnedWeb = true;
      // eslint-disable-next-line no-console -- reviewer-facing note: the lock is a no-op in the browser preview
      console.info('[AppLock] web preview: app lock and privacy overlay are disabled.');
    }
    return <>{children}</>;
  }
  return <NativeAppLockGate>{children}</NativeAppLockGate>;
}

function NativeAppLockGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { biometricLock, lockGraceSeconds, setBiometricLock } = usePreferences();
  const toast = useToast();
  const { colors } = useTheme();

  const [state, dispatch] = useReducer(appLockReducer, undefined, () => {
    // Read synchronously so the first frame is already covered when the
    // preference is on; waiting for the provider's state would flash the
    // transcript for one frame on every cold start.
    const stored = readLockPreferences();
    return initialAppLockState({
      enabled: stored.biometricLock,
      graceSeconds: stored.lockGraceSeconds,
      appState: (AppState.currentState ?? 'active') as AppStateName,
    });
  });

  // Preference changes flow into the machine; the machine never writes the
  // preference back except in the "nothing to lock with" case below.
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

  // One prompt at a time. iOS in particular returns `app_cancel` for a second
  // `authenticateAsync` while the first sheet is up.
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
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock GeneratorAI',
        cancelLabel: 'Cancel',
        // Passcode is fine: the lock is about presence, not about biometrics
        // specifically, and a phone without a sensor still deserves one.
        disableDeviceFallback: false,
      });
      if (result.success) dispatch({ type: 'authSucceeded' });
      else dispatch({ type: 'authFailed', failure: result.error });
    } catch {
      dispatch({ type: 'authFailed', failure: 'unknown' });
    } finally {
      promptingRef.current = false;
    }
  }, []);

  // Prompt whenever the machine says so: cold start, and every return from
  // the background past the grace. Not on a retryable failure — the user
  // taps Unlock for that, otherwise a cancel loops straight back into the
  // sheet and there is no way to reach the phone's own UI.
  const prompt = shouldPromptAuth(state);
  const failure = state.failure;
  useEffect(() => {
    if (prompt && !failure) void authenticate();
  }, [prompt, failure, authenticate]);

  // "Nothing to lock with": the reducer already unlocked; persist the
  // decision and explain it once, rather than silently every launch.
  useEffect(() => {
    if (failure && !isRetryableFailure(failure) && biometricLock) {
      setBiometricLock(false);
      toast({ message: describeFailure(failure), variant: 'warning', duration: 6000 });
    }
  }, [failure, biometricLock, setBiometricLock, toast]);

  const cover = shouldCoverContent(state);
  const privacyOnly = shouldShowPrivacyOverlay(state);

  return (
    <View className="flex-1">
      <View
        className="flex-1"
        accessibilityElementsHidden={cover}
        importantForAccessibility={cover ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>

      {cover ? (
        <View
          className="absolute inset-0 items-center justify-center bg-background px-8"
          accessibilityViewIsModal
          // Anything the user could reach behind this layer would be a leak.
          pointerEvents="auto"
          testID={privacyOnly ? 'privacy-overlay' : 'app-lock'}
        >
          {privacyOnly ? (
            <AppMark color={colors.primary} />
          ) : (
            <LockScreen
              failure={failure}
              authenticating={state.phase === 'authenticating'}
              onUnlock={() => void authenticate()}
              color={colors.primary}
              muted={colors['muted-foreground']}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The app mark, standing in for an icon asset the project does not ship
 * (there is no `assets/` directory and `app.config.ts` sets no `icon`).
 * Once one exists this becomes an `<Image>` of it.
 */
function AppMark({ color }: { color: string | undefined }): React.ReactElement {
  return (
    <View className="items-center gap-3" accessibilityLabel="GeneratorAI">
      <View className="h-20 w-20 items-center justify-center rounded-3xl bg-subtle">
        <Sparkles size={36} color={color} />
      </View>
      <Text className="text-lg font-semibold text-foreground">GeneratorAI</Text>
    </View>
  );
}

function LockScreen({
  failure,
  authenticating,
  onUnlock,
  color,
  muted,
}: {
  failure: LockFailure | null;
  authenticating: boolean;
  onUnlock: () => void;
  color: string | undefined;
  muted: string | undefined;
}): React.ReactElement {
  return (
    <View className="w-full max-w-sm items-center gap-6">
      <View className="h-20 w-20 items-center justify-center rounded-3xl bg-subtle">
        {authenticating ? <ScanFace size={36} color={color} /> : <Lock size={36} color={color} />}
      </View>
      <View className="items-center gap-1">
        <Text accessibilityRole="header" className="text-xl font-semibold text-foreground">
          GeneratorAI is locked
        </Text>
        <Text className="text-center text-sm leading-relaxed text-muted-foreground">
          {authenticating
            ? 'Confirm it is you to continue.'
            : failure
              ? describeFailure(failure)
              : 'Unlock with Face ID, Touch ID, fingerprint or your passcode.'}
        </Text>
      </View>
      <Button
        label="Unlock"
        variant="primary"
        onPress={onUnlock}
        disabled={authenticating}
        loading={authenticating}
        accessibilityHint="Opens the system unlock prompt"
      />
      <Text className="text-center text-xs" style={{ color: muted }}>
        Turn app lock off in Settings › Accessibility.
      </Text>
    </View>
  );
}

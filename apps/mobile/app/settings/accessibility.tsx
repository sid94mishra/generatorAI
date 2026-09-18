// ────────────────────────────────────────────────────────────────
// Settings → Accessibility.
//
// D8: the motion and haptics preferences existed in storage with no way to
// set them, and `biometricLock` was a key nothing read. This screen makes
// every one of them real, on the same grouped-list shape as Appearance.
//
// Text size is deliberately read-only here. It is an OS setting on both
// platforms, and an app-level multiplier would disagree with every other
// app on the phone. What the row shows instead is the truth: the scale the
// system is applying right now and the ceiling the app's chrome respects.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { Contrast, Fingerprint, Heading1, Lock, Mic, Type, Vibrate, Wind } from 'lucide-react-native';

import { Badge, Card, SectionHeader } from '../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Screen } from '../../src/components/ui/Screen';
import { MAX_SCALE, useFontScale, useSystemReduceMotion } from '../../src/components/ui/accessibility';
import { useTheme } from '../../src/theme/ThemeProvider';
import {
  LOCK_GRACE_OPTIONS,
  usePreferences,
  type LockGraceSeconds,
  type MotionPreference,
} from '../../src/prefs/preferences';
import { readPushToTalk, writePushToTalk } from '../../src/voice/pushToTalk';

const MOTION_SEGMENTS: ReadonlyArray<{ value: MotionPreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'full', label: 'Full' },
];

type GraceValue = `${LockGraceSeconds}`;

const GRACE_SEGMENTS: ReadonlyArray<{ value: GraceValue; label: string }> = LOCK_GRACE_OPTIONS.map(
  (option) => ({
    value: `${option.seconds}` as GraceValue,
    label: option.label === 'Immediately' ? 'Now' : option.label.replace(' minutes', ' min').replace(' minute', ' min'),
  }),
);

/** What the phone can lock with. `null` while still being asked. */
type Credential = 'biometric' | 'passcode' | 'none' | null;

function useDeviceCredential(): Credential {
  const [credential, setCredential] = useState<Credential>(null);
  useEffect(() => {
    let alive = true;
    if (Platform.OS === 'web') {
      setCredential('none');
      return () => {
        alive = false;
      };
    }
    void (async () => {
      try {
        const level = await LocalAuthentication.getEnrolledLevelAsync();
        if (!alive) return;
        if (level === LocalAuthentication.SecurityLevel.NONE) setCredential('none');
        else if (level === LocalAuthentication.SecurityLevel.SECRET) setCredential('passcode');
        else setCredential('biometric');
      } catch {
        if (alive) setCredential('none');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return credential;
}

export default function AccessibilityScreen(): React.ReactElement {
  const { colors } = useTheme();
  const {
    motion,
    setMotion,
    haptics,
    setHaptics,
    biometricLock,
    setBiometricLock,
    lockGraceSeconds,
    setLockGraceSeconds,
    largeTitleCollapse,
    setLargeTitleCollapse,
  } = usePreferences();
  const systemReduce = useSystemReduceMotion();
  const fontScale = useFontScale();
  const credential = useDeviceCredential();
  // Composer-owned MMKV key (`src/voice/pushToTalk.ts`); the controller reads
  // it when a chat screen mounts, so a change applies to the next chat opened.
  const [pushToTalk, setPushToTalkState] = useState<boolean>(() => readPushToTalk());
  const setPushToTalk = (next: boolean): void => {
    writePushToTalk(next);
    setPushToTalkState(next);
  };

  const effectiveReduce = motion === 'reduced' || (motion === 'system' && systemReduce);
  const canLock = credential === 'biometric' || credential === 'passcode';
  const hapticsSupported = Platform.OS === 'ios' || Platform.OS === 'android';

  return (
    <Screen title="Accessibility" back>
      <SectionHeader title="Motion" />
      <Card className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
            <Wind size={18} color={colors.primary} />
          </View>
          <View className="flex-1">
            <Text className="text-md font-medium text-foreground">Reduce motion</Text>
            <Text className="text-sm text-muted-foreground">
              {motion === 'system'
                ? `Following the system setting (currently ${systemReduce ? 'on' : 'off'})`
                : effectiveReduce
                  ? 'Springs and slides jump straight to their end'
                  : 'Full animation, even if the system asks for less'}
            </Text>
          </View>
        </View>
        <SegmentedControl
          segments={MOTION_SEGMENTS}
          value={motion}
          onChange={setMotion}
          accessibilityLabel="Reduce motion"
        />
      </Card>

      <SectionHeader title="Touch" />
      <ListGroup>
        <ListRow
          title="Haptics"
          subtitle={
            hapticsSupported
              ? 'Taps, selections and confirmations give a small physical response'
              : 'Not available in the browser preview'
          }
          icon={<Vibrate size={18} color={colors.info} />}
          disabled={!hapticsSupported}
          toggle={{ value: haptics && hapticsSupported, onValueChange: setHaptics }}
        />
      </ListGroup>
      <Text className="text-xs leading-relaxed text-muted-foreground">
        The app uses one light vocabulary — select, tap, commit, warn — rather than a strength
        slider, so there is no intensity setting to tune.
      </Text>

      <SectionHeader title="Voice" />
      <ListGroup>
        <ListRow
          title="Push to talk"
          subtitle={
            pushToTalk
              ? 'Hold the mic to dictate; release to accept'
              : 'Tap the mic to start dictating, tap again to accept'
          }
          icon={<Mic size={18} color={colors.primary} />}
          toggle={{ value: pushToTalk, onValueChange: setPushToTalk }}
        />
      </ListGroup>

      <SectionHeader title="Reading" />
      <ListGroup>
        <ListRow
          title="Text size"
          subtitle={
            fontScale === 1
              ? 'Default size. Change it in your phone’s settings.'
              : `${Math.round(fontScale * 100)}% of default, set by your phone`
          }
          icon={<Type size={18} color={colors.primary} />}
          onPress={() => {
            // Neither platform exposes a direct deep link to the text-size
            // pane that survives OS versions; the app settings page is the
            // closest stable entry point on both.
            void Linking.openSettings();
          }}
          trailing={<Badge label={`×${fontScale.toFixed(2)}`} tone="neutral" />}
          accessibilityHint="Opens the system settings"
        />
        <ListRow
          title="Large titles collapse"
          subtitle="Shrink the screen title into the bar as you scroll"
          icon={<Heading1 size={18} color={colors['muted-foreground']} />}
          toggle={{ value: largeTitleCollapse, onValueChange: setLargeTitleCollapse }}
        />
        <ListRow
          title="High contrast theme"
          subtitle="Pick a theme with stronger borders and text"
          icon={<Contrast size={18} color={colors.warning} />}
          onPress={() => router.push('/settings/appearance')}
        />
      </ListGroup>
      <Card className="gap-2 p-4">
        <Text className="text-sm leading-relaxed text-foreground">
          Body text follows your phone’s size without limit. Chrome that shares a row with other
          controls — badges, tab labels, counts — caps at ×{MAX_SCALE.chrome}, and titles at ×
          {MAX_SCALE.control}, so nothing is pushed off the screen.
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Badge label="Badge" tone="primary" />
          <Text className="text-md font-medium text-foreground">Row title</Text>
          <Text className="text-sm text-muted-foreground">Subtitle at body scale</Text>
        </View>
      </Card>

      <SectionHeader title="App lock" />
      <ListGroup>
        <ListRow
          title="Require unlock"
          subtitle={
            credential === null
              ? 'Checking what this phone can unlock with…'
              : credential === 'biometric'
                ? 'Face ID, Touch ID or fingerprint, with passcode as a fallback'
                : credential === 'passcode'
                  ? 'No biometrics enrolled — the device passcode will be used'
                  : Platform.OS === 'web'
                    ? 'Not available in the browser preview'
                    : 'This phone has no passcode or biometrics, so there is nothing to lock with'
          }
          icon={<Fingerprint size={18} color={canLock ? colors.success : colors['muted-foreground']} />}
          disabled={!canLock}
          toggle={{ value: biometricLock && canLock, onValueChange: setBiometricLock }}
        />
      </ListGroup>
      {biometricLock && canLock ? (
        <Card className="gap-3 p-4">
          <View className="flex-row items-center gap-3">
            <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
              <Lock size={18} color={colors.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-md font-medium text-foreground">Lock after leaving</Text>
              <Text className="text-sm text-muted-foreground">
                How long the app can sit in the background before it asks again
              </Text>
            </View>
          </View>
          <SegmentedControl
            segments={GRACE_SEGMENTS}
            value={`${lockGraceSeconds}` as GraceValue}
            onChange={(next) => setLockGraceSeconds(Number(next) as LockGraceSeconds)}
            accessibilityLabel="Lock after leaving"
          />
          <Text className="text-xs leading-relaxed text-muted-foreground">
            While locked or in the app switcher, the screen shows only the app mark — never a
            transcript. Sensitive actions such as opening a terminal ask again regardless.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

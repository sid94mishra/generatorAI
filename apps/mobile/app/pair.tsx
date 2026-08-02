// ────────────────────────────────────────────────────────────────
// Pairing — scan a QR, review consent, enrol.
//
// ── Why the consent step is not skippable ────────────────────────
// A pairing code is entirely attacker-controllable: a user can be tricked
// into scanning a hostile QR from a screen, a sticker, or a chat message.
// So the flow is strictly:
//
//   scan → PARSE (strict schema) → SHOW the host identity and the exact
//   scopes → user confirms → only then enrol
//
// The fingerprint on this screen is the SAME value the server displays next
// to its QR. Comparing them is what defeats a swapped code, and it is the
// only step a user can perform that a machine cannot do for them.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-application';
import { router } from 'expo-router';
import { PairingCodeError, parsePairingCode, type PairingConsent } from '@generatorai/client-runtime';

import { useAuth } from '../src/auth/AuthProvider';
import { describeScope } from '../src/auth/scopeLabels';
import { Spinner } from '../src/components/common/States';
import { useTheme } from '../src/theme/ThemeProvider';

type Phase = 'scan' | 'manual' | 'consent' | 'enrolling';

export default function PairScreen(): React.ReactElement {
  const { completePairing } = useAuth();
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('scan');
  const [consent, setConsent] = useState<PairingConsent | null>(null);
  const [deviceName, setDeviceName] = useState(Device.nativeApplicationVersion ? 'My phone' : 'My phone');
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  // Guards against the camera firing the same code dozens of times per second.
  const [scanned, setScanned] = useState(false);

  /**
   * Shared by the scanner and the manual field so both land on the SAME
   * consent screen. The fingerprint check is the security boundary here, and
   * no entry path may skip it.
   */
  const acceptCode = useCallback((data: string): boolean => {
    try {
      setConsent(parsePairingCode(data));
      setError(null);
      setPhase('consent');
      return true;
    } catch (err) {
      setError(
        err instanceof PairingCodeError
          ? err.message
          : 'That is not a GeneratorAI pairing code.',
      );
      return false;
    }
  }, []);

  const onScanned = useCallback((data: string) => {
    if (scanned) return;
    setScanned(true);
    if (!acceptCode(data)) {
      // Re-arm so the user can simply point at a different code.
      setTimeout(() => setScanned(false), 1200);
    }
  }, [scanned, acceptCode]);

  const onSubmitManual = useCallback(() => {
    const raw = manualCode.trim();
    if (!raw) return;
    acceptCode(raw);
  }, [manualCode, acceptCode]);

  const onConfirm = useCallback(async () => {
    if (!consent) return;
    setPhase('enrolling');
    setError(null);
    try {
      await completePairing(consent, deviceName.trim() || 'Mobile device');
      router.replace('/(tabs)');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('consent');
    }
  }, [consent, deviceName, completePairing]);

  // Manual entry is checked BEFORE the camera gate on purpose: it is the
  // fallback for precisely the situations where the camera is unusable —
  // permission hard-denied (iOS will not re-prompt, so the "Allow camera"
  // button silently does nothing), no camera hardware, or the desktop web
  // preview. Without this the screen is a dead end with no way forward.
  if (phase === 'manual') {
    return (
      <ScrollView contentContainerClassName="gap-5 px-6 py-8">
        <View className="gap-1">
          <Text className="text-xl font-semibold text-foreground">Enter pairing code</Text>
          <Text className="text-sm text-muted-foreground">
            On your GeneratorAI server open Settings → Security → Pair a device, then copy the
            code shown under the QR image.
          </Text>
        </View>

        <View className="gap-2">
          <TextInput
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="generatorai://pair?code=…"
            className="rounded-lg border border-input bg-background px-3 py-3 text-foreground"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            onSubmitEditing={onSubmitManual}
          />
          {error ? <Text className="text-sm text-danger">{error}</Text> : null}
        </View>

        <View className="gap-3">
          <Pressable
            accessibilityRole="button"
            disabled={manualCode.trim().length === 0}
            onPress={onSubmitManual}
            className="items-center rounded-lg bg-primary-emphasis px-5 py-4 disabled:opacity-60"
          >
            <Text className="font-semibold text-primary-foreground">Continue</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError(null);
              setPhase('scan');
            }}
            className="items-center px-5 py-3"
          >
            <Text className="text-sm text-muted-foreground">Scan a QR code instead</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // Camera permission gates the SCAN phase only.
  //
  // These used to run before every phase check, which was harmless when the
  // camera was the sole entry point. Now that a code can arrive by hand, a
  // blanket gate would bounce the user straight back to "Camera access
  // needed" the moment they submitted a valid code — hiding the consent
  // screen behind a permission the manual path never needs.
  if (phase === 'scan') {
    if (!permission) {
      return (
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      );
    }

    if (!permission.granted) {
      return (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Text className="text-center text-lg font-semibold text-foreground">
            Camera access needed
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            Pairing uses the camera to read the QR code shown by your GeneratorAI server. The
            camera is used for nothing else.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void requestPermission()}
            className="rounded-lg bg-primary-emphasis px-5 py-3"
          >
            <Text className="font-semibold text-primary-foreground">Allow camera</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setPhase('manual')}
            className="px-5 py-2"
          >
            <Text className="text-sm text-muted-foreground">Enter the code manually instead</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View className="flex-1">
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => onScanned(data)}
        />
        <View className="absolute inset-x-0 bottom-0 gap-2 bg-overlay/90 px-6 pb-10 pt-5">
          <Text className="text-center text-base font-semibold text-foreground">
            Scan the pairing code
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            Open Settings → Security → Pair a device on your GeneratorAI server.
          </Text>
          {error ? <Text className="text-center text-sm text-danger">{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError(null);
              setPhase('manual');
            }}
            className="items-center pt-1"
          >
            <Text className="text-sm text-muted-foreground underline">Enter the code manually</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerClassName="gap-5 px-6 py-8">
      <View className="gap-1">
        <Text className="text-xl font-semibold text-foreground">Pair with this server?</Text>
        <Text className="text-sm text-muted-foreground">
          Only continue if the fingerprint below matches the one on your server screen.
        </Text>
      </View>

      <View className="gap-3 rounded-lg border border-border bg-card p-4">
        <Row label="Server" value={consent?.serverName ?? ''} />
        <Row label="Address" value={consent?.endpoint ?? ''} mono />
        <View className="gap-1">
          <Text className="text-xs uppercase tracking-wide text-muted-foreground">Fingerprint</Text>
          {/* Large and monospaced: this is the one thing the user must
              actually compare, character by character. */}
          <Text className="font-mono text-lg tracking-widest text-foreground">
            {consent?.fingerprint}
          </Text>
        </View>
      </View>

      <View className="gap-2 rounded-lg border border-border bg-card p-4">
        <Text className="text-sm font-semibold text-foreground">This device will be able to</Text>
        {consent?.requestedScopes.map((scope) => (
          <View key={scope} className="flex-row gap-2">
            <Text className="text-muted-foreground">•</Text>
            <Text className="flex-1 text-sm text-muted-foreground">{describeScope(scope)}</Text>
          </View>
        ))}
        <Text className="mt-1 text-xs text-muted-foreground">
          Terminal and browser control are not included. You can grant them later, per device.
        </Text>
      </View>

      <View className="gap-2">
        <Text className="text-xs uppercase tracking-wide text-muted-foreground">Device name</Text>
        <TextInput
          value={deviceName}
          onChangeText={setDeviceName}
          placeholder="My phone"
          className="rounded-lg border border-input bg-background px-3 py-3 text-foreground"
          autoCapitalize="words"
        />
        <Text className="text-xs text-muted-foreground">
          Shown in your server&apos;s device list so you can revoke it later.
        </Text>
      </View>

      {error ? <Text className="text-sm text-danger">{error}</Text> : null}

      <View className="gap-3">
        <Pressable
          accessibilityRole="button"
          disabled={phase === 'enrolling'}
          onPress={() => void onConfirm()}
          className="items-center rounded-lg bg-primary-emphasis px-5 py-4 disabled:opacity-60"
        >
          {phase === 'enrolling' ? (
            // Sits on `bg-primary-emphasis`, so it must use the paired
            // foreground token rather than a hardcoded white — the accent
            // palettes differ between light and dark.
            <ActivityIndicator color={colors['primary-foreground']} />
          ) : (
            <Text className="font-semibold text-primary-foreground">Pair this device</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setPhase('scan');
            setConsent(null);
            setScanned(false);
            setManualCode('');
          }}
          className="items-center px-5 py-3"
        >
          <Text className="text-sm text-muted-foreground">Cancel</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <View className="gap-1">
      <Text className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Text>
      <Text className={`text-sm text-foreground ${mono ? 'font-mono' : ''}`}>{value}</Text>
    </View>
  );
}

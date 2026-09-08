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
//
// D22 — rebuilt on the design system: safe areas, `Screen`, `Card`,
// `ListGroup`/`ListRow`, `Button`, `Field`. The consent screen groups the
// offered scopes into Read / Act / Sensitive (sensitive highlighted) and
// names the preset the offer matches, so "Mobile companion" and "Full
// workstation" read as different decisions rather than two long lists.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Camera, KeyRound, Link2, QrCode, Server, ShieldAlert, ShieldCheck } from 'lucide-react-native';
import { PairingCodeError, parsePairingCode, type PairingConsent } from '@generatorai/client-runtime';
import { isPairingCode } from '@generatorai/shared';

import { useAuth } from '../src/auth/AuthProvider';
import { describeScope, isSensitiveScope } from '../src/auth/scopeLabels';
import { groupScopes, matchScopePreset } from '../src/auth/scopePresets';
import { Button } from '../src/components/ui/Button';
import { Field } from '../src/components/ui/Form';
import { ListGroup, ListRow } from '../src/components/ui/ListRow';
import { Badge, Card, SectionHeader } from '../src/components/ui/primitives';
import { Screen } from '../src/components/ui/Screen';
import { EmptyState, Spinner } from '../src/components/ui/States';
import { haptics } from '../src/components/ui/haptics';
import { useTheme } from '../src/theme/ThemeProvider';

type Phase = 'scan' | 'manual' | 'consent' | 'enrolling';

export default function PairScreen(): React.ReactElement {
  const { completePairing } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('scan');
  const [consent, setConsent] = useState<PairingConsent | null>(null);
  const [deviceName, setDeviceName] = useState('My phone');
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
      haptics.success();
      return true;
    } catch (err) {
      // The short code (`4H7K-2M9P-XQ3T`) carries no server address, so this
      // app cannot resolve it: the web flow works only because that device
      // opened the server in a browser first, which IS the address. Say so,
      // rather than reporting "does not contain valid JSON" at a user who
      // typed exactly what the host screen showed them.
      setError(
        isPairingCode(data)
          ? 'That short code only works in a browser opened at the server’s address. On this app, scan the QR code instead.'
          : err instanceof PairingCodeError
            ? err.message
            : 'That is not a GeneratorAI pairing code.',
      );
      haptics.error();
      return false;
    }
  }, []);

  const onScanned = useCallback(
    (data: string) => {
      if (scanned) return;
      setScanned(true);
      if (!acceptCode(data)) {
        // Re-arm so the user can simply point at a different code.
        setTimeout(() => setScanned(false), 1200);
      }
    },
    [scanned, acceptCode],
  );

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
      haptics.success();
      router.replace('/(tabs)');
    } catch (err) {
      haptics.error();
      setError(err instanceof Error ? err.message : String(err));
      setPhase('consent');
    }
  }, [consent, deviceName, completePairing]);

  const reset = useCallback(() => {
    setPhase('scan');
    setConsent(null);
    setScanned(false);
    setManualCode('');
    setError(null);
  }, []);

  const preset = useMemo(
    () => (consent ? matchScopePreset(consent.requestedScopes) : null),
    [consent],
  );
  const groups = useMemo(
    () => (consent ? groupScopes(consent.requestedScopes, isSensitiveScope) : []),
    [consent],
  );

  // Manual entry is checked BEFORE the camera gate on purpose: it is the
  // fallback for precisely the situations where the camera is unusable —
  // permission hard-denied (iOS will not re-prompt, so the "Allow camera"
  // button silently does nothing), no camera hardware, or the desktop web
  // preview. Without this the screen is a dead end with no way forward.
  if (phase === 'manual') {
    return (
      <Screen
        title="Enter pairing code"
        subtitle="Paste a pairing link from your GeneratorAI server."
        back
        onBack={() => {
          setError(null);
          setPhase('scan');
        }}
      >
        <Card className="gap-3 p-4">
          {/* Deliberately NOT "the code shown under the QR image": that is the
              short code, which carries no server address and only works in a
              browser already opened at the host. */}
          <Text className="text-sm leading-relaxed text-muted-foreground">
            The short code shown next to the QR image will not work here — it has no server
            address. Scan the QR instead, or paste the full link.
          </Text>
          <Field
            label="Pairing link"
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="generatorai://pair?code=…"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            onSubmitEditing={onSubmitManual}
            error={error}
          />
        </Card>

        <Button
          label="Continue"
          size="lg"
          full
          disabled={manualCode.trim().length === 0}
          onPress={onSubmitManual}
        />
        <Button
          label="Scan a QR code instead"
          variant="ghost"
          icon={<QrCode size={16} color={colors.primary} />}
          haptic="tap"
          onPress={() => {
            setError(null);
            setPhase('scan');
          }}
        />
      </Screen>
    );
  }

  // Camera permission gates the SCAN phase only: a blanket gate would bounce
  // the user straight back to "Camera access needed" the moment they
  // submitted a valid code by hand.
  if (phase === 'scan') {
    if (!permission) {
      return (
        <View className="flex-1 items-center justify-center bg-background">
          <Spinner />
        </View>
      );
    }

    if (!permission.granted) {
      return (
        <Screen title="Pair this phone" subtitle="Scan the code your GeneratorAI server shows.">
          <EmptyState
            title="Camera access needed"
            message="Pairing uses the camera to read the QR code shown by your GeneratorAI server. The camera is used for nothing else."
            icon={<Camera size={22} color={colors['muted-foreground']} />}
          />
          <Button label="Allow camera" size="lg" full onPress={() => void requestPermission()} />
          <Button
            label="Enter the code manually instead"
            variant="ghost"
            icon={<Link2 size={16} color={colors.primary} />}
            haptic="tap"
            onPress={() => setPhase('manual')}
          />
        </Screen>
      );
    }

    return (
      <View className="flex-1 bg-background">
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => onScanned(data)}
        />
        <View
          className="absolute inset-x-0 bottom-0 gap-3 rounded-t-4xl border-t border-border bg-card px-6 pt-5"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="flex-row items-center gap-2.5">
            <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
              <QrCode size={18} color={colors.primary} />
            </View>
            <View className="flex-1">
              <Text accessibilityRole="header" className="text-md font-semibold text-foreground">
                Scan the pairing code
              </Text>
              <Text className="text-sm text-muted-foreground">
                Settings › Security › Pair a device, on your GeneratorAI server.
              </Text>
            </View>
          </View>
          {error ? (
            <Text accessibilityLiveRegion="assertive" className="text-sm text-danger">
              {error}
            </Text>
          ) : null}
          <Button
            label="Enter the code manually"
            variant="secondary"
            full
            haptic="tap"
            onPress={() => {
              setError(null);
              setPhase('manual');
            }}
          />
        </View>
      </View>
    );
  }

  // ── Consent ──────────────────────────────────────────────────────
  const enrolling = phase === 'enrolling';
  const sensitiveCount = groups.find((g) => g.id === 'sensitive')?.scopes.length ?? 0;

  return (
    <Screen
      title="Pair with this server?"
      subtitle="Only continue if the fingerprint matches the one on your server screen."
      back
      onBack={reset}
    >
      <ListGroup>
        <ListRow
          title={consent?.serverName ?? 'Server'}
          subtitle={consent?.endpoint ?? ''}
          icon={<Server size={18} color={colors['muted-foreground']} />}
        />
        <View className="gap-1 px-4 py-3">
          <Text className="text-sm font-medium text-foreground">Fingerprint</Text>
          {/* Large and monospaced: this is the one thing the user must
              actually compare, character by character. */}
          <Text
            selectable
            accessibilityLabel={`Fingerprint ${consent?.fingerprint ?? ''}`}
            className="font-mono text-lg tracking-widest text-foreground"
          >
            {consent?.fingerprint}
          </Text>
        </View>
      </ListGroup>

      <SectionHeader
        title="This device will be able to"
        action={
          <Badge
            label={preset ? preset.label : 'Custom grant'}
            tone={preset ? (preset.id === 'companion' || preset.id === 'readonly' ? 'success' : 'warning') : 'neutral'}
            icon={
              preset && (preset.id === 'companion' || preset.id === 'readonly') ? (
                <ShieldCheck size={12} color={colors.success} />
              ) : (
                <ShieldAlert size={12} color={preset ? colors.warning : colors['muted-foreground']} />
              )
            }
          />
        }
      />
      {preset ? (
        <Text className="px-1 text-xs leading-relaxed text-muted-foreground">{preset.hint}</Text>
      ) : (
        <Text className="px-1 text-xs leading-relaxed text-muted-foreground">
          This offer does not match a standard preset. Read the list before you continue.
        </Text>
      )}

      {groups.map((group) => (
        <View key={group.id} className="gap-2">
          <Text
            accessibilityRole="header"
            className={`px-1 text-sm font-semibold ${group.id === 'sensitive' ? 'text-warning' : 'text-muted-foreground'}`}
          >
            {group.title}
            {group.id === 'sensitive' ? ' — granted only when you say so' : ''}
          </Text>
          <Card className={`gap-2 p-3.5 ${group.id === 'sensitive' ? 'border-warning' : ''}`}>
            {group.scopes.map((scope) => (
              <View key={scope} className="flex-row items-start gap-2">
                {group.id === 'sensitive' ? (
                  <ShieldAlert size={14} color={colors.warning} style={{ marginTop: 2 }} />
                ) : (
                  <Text className="text-muted-foreground">•</Text>
                )}
                <Text
                  className={`flex-1 text-sm ${group.id === 'sensitive' ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {describeScope(scope)}
                </Text>
              </View>
            ))}
          </Card>
        </View>
      ))}

      <Text className="px-1 text-xs leading-relaxed text-muted-foreground">
        {sensitiveCount === 0
          ? 'Terminal and browser control are not included. You can grant them later, per device.'
          : `${sensitiveCount} sensitive permission${sensitiveCount === 1 ? '' : 's'} let this phone act on the machine running GeneratorAI. You can revoke any of them later, per device.`}
      </Text>

      <SectionHeader title="Device name" />
      <Field
        label="Name"
        hint="Shown in your server’s device list so you can revoke it later."
        value={deviceName}
        onChangeText={setDeviceName}
        placeholder="My phone"
        autoCapitalize="words"
      />

      {error ? (
        <Text accessibilityLiveRegion="assertive" className="text-sm text-danger">
          {error}
        </Text>
      ) : null}

      <Button
        label="Pair this device"
        size="lg"
        full
        loading={enrolling}
        icon={<KeyRound size={18} color={colors['primary-foreground']} />}
        onPress={() => void onConfirm()}
      />
      <Button label="Cancel" variant="ghost" haptic="tap" disabled={enrolling} onPress={reset} />
    </Screen>
  );
}

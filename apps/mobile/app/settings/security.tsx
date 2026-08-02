// ────────────────────────────────────────────────────────────────
// Settings → Security.
//
// The screen that justifies having this app on a phone: what this device is
// allowed to do, how its key is protected, which other devices exist, and
// how to revoke any of them from wherever you happen to be standing.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as LocalAuthentication from 'expo-local-authentication';
import { ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react-native';

import { useAuth } from '../../src/auth/AuthProvider';
import { describeScope, isSensitiveScope } from '../../src/auth/scopeLabels';
import { checkFeature } from '../../src/auth/featureGate';
import { useTheme } from '../../src/theme/ThemeProvider';

interface DeviceRecord {
  deviceId: string;
  deviceName: string;
  platform: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  scopes: string[];
}

interface PostureWarning {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

interface Posture {
  server: { hostId: string; loopbackOnly: boolean; production: boolean };
  authentication: { required: boolean; dpopRequired: boolean; legacyApiKeyActive: boolean };
  secretStore: { kind: string; secure: boolean; reason?: string };
  relay: { enabled: boolean; state: string };
  warnings: PostureWarning[];
}

const KEY_BACKING_LABEL: Record<string, string> = {
  'secure-enclave': 'Secure Enclave',
  strongbox: 'StrongBox (hardware)',
  keystore: 'Android Keystore',
  software: 'Software (this device has no secure element)',
  'web-preview': 'Browser localStorage — NOT protected (web preview build)',
};

export default function SecurityScreen(): React.ReactElement {
  const { state, transport, keyBacking, fetch: authFetch, unpair } = useAuth();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const scopes = state.status === 'authenticated' ? state.scopes : [];

  // Listing and revoking other devices needs `admin:devices`, which a paired
  // phone is deliberately NOT granted by default. Asking anyway produced a
  // 403 that the UI rendered as a raw "Devices request failed (403)" — a
  // withheld permission read as a broken screen. Skip the request and say so.
  const deviceAdmin = checkFeature('deviceAdmin', scopes);

  const devices = useQuery({
    queryKey: ['auth', 'devices'],
    queryFn: async (): Promise<DeviceRecord[]> => {
      const res = await authFetch('/api/auth/devices');
      if (!res.ok) throw new Error(`Devices request failed (${res.status})`);
      return ((await res.json()) as { devices: DeviceRecord[] }).devices;
    },
    enabled: deviceAdmin.available,
  });

  const posture = useQuery({
    queryKey: ['security', 'posture'],
    queryFn: async (): Promise<Posture> => {
      const res = await authFetch('/api/security/posture');
      if (!res.ok) throw new Error(`Posture request failed (${res.status})`);
      return (await res.json()) as Posture;
    },
  });

  /**
   * Revoking a device is destructive and immediate, so it requires a local
   * biometric check first. A phone left unlocked on a desk must not be able
   * to cut off someone's laptop with two taps.
   */
  const revokeDevice = useCallback(
    async (device: DeviceRecord) => {
      const hasBiometrics = await LocalAuthentication.hasHardwareAsync();
      if (hasBiometrics) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: `Revoke ${device.deviceName}?`,
        });
        if (!result.success) return;
      }

      setBusy(device.deviceId);
      try {
        const res = await authFetch(`/api/auth/devices/${device.deviceId}/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'Revoked from mobile' }),
        });
        if (!res.ok) throw new Error(`Revoke failed (${res.status})`);
        await queryClient.invalidateQueries({ queryKey: ['auth', 'devices'] });
      } catch (err) {
        Alert.alert('Could not revoke', err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [authFetch, queryClient],
  );

  const confirmUnpair = useCallback(() => {
    Alert.alert(
      'Unpair this device?',
      'This device will lose access immediately. You will need to scan a new pairing code to reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unpair', style: 'destructive', onPress: () => void unpair() },
      ],
    );
  }, [unpair]);

  const hardwareBacked = keyBacking !== 'software' && keyBacking !== 'web-preview';

  return (
    <ScrollView
      contentContainerClassName="gap-6 px-4 py-6"
      refreshControl={
        <RefreshControl
          refreshing={devices.isFetching || posture.isFetching}
          onRefresh={() => {
            void devices.refetch();
            void posture.refetch();
          }}
          tintColor={colors['muted-foreground']}
        />
      }
    >
      {/* ── This device ── */}
      <Section title="This device">
        <View className="flex-row items-center gap-3">
          {hardwareBacked ? (
            <ShieldCheck size={20} color={colors.success} />
          ) : (
            <ShieldAlert size={20} color={colors.warning} />
          )}
          <View className="flex-1">
            <Text className="text-sm font-medium text-foreground">
              Key protection: {KEY_BACKING_LABEL[keyBacking] ?? keyBacking}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {hardwareBacked
                ? 'The signing key cannot leave this device, even if the app is compromised.'
                : 'No secure element available, so the key is stored encrypted but is extractable. Treat this device as lower trust.'}
            </Text>
          </View>
        </View>

        <Divider />

        <Field label="Connection">
          {transport.state === 'connected'
            ? `${transport.kind} — ${transport.endpoint}`
            : transport.state === 'host-mismatch'
              ? 'Blocked: server identity changed'
              : transport.state}
        </Field>
      </Section>

      {/* ── Permissions ── */}
      <Section title="What this device can do">
        {scopes.length === 0 ? (
          <Text className="text-sm text-muted-foreground">Not paired.</Text>
        ) : (
          scopes.map((scope) => (
            <View key={scope} className="flex-row gap-2">
              <Text className={isSensitiveScope(scope) ? 'text-warning' : 'text-muted-foreground'}>
                •
              </Text>
              <Text className="flex-1 text-sm text-muted-foreground">{describeScope(scope)}</Text>
            </View>
          ))
        )}
        <Text className="mt-1 text-xs text-muted-foreground">
          Terminal and browser control are withheld by default. Grant them from a trusted device
          only when you need them.
        </Text>
      </Section>

      {/* ── Server posture ── */}
      <Section title="Server">
        {posture.isLoading ? (
          <ActivityIndicator color={colors['muted-foreground']} />
        ) : posture.data ? (
          <>
            <Field label="Identity" mono>
              {formatFingerprint(posture.data.server.hostId)}
            </Field>
            <Field label="Secret storage">
              {posture.data.secretStore.secure
                ? `${posture.data.secretStore.kind} (OS-backed)`
                : `${posture.data.secretStore.kind} — not OS-backed`}
            </Field>
            <Field label="Remote access">
              {posture.data.relay.enabled ? `Relay ${posture.data.relay.state}` : 'Local only'}
            </Field>

            {posture.data.warnings.length > 0 ? (
              <View className="mt-2 gap-2">
                {posture.data.warnings.map((w) => (
                  <View
                    key={w.code}
                    className={`rounded-lg border p-3 ${
                      w.severity === 'critical'
                        ? 'border-danger bg-danger-muted'
                        : 'border-warning bg-warning-muted'
                    }`}
                  >
                    <Text className="text-sm text-foreground">{w.message}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <Text className="text-sm text-danger">{String(posture.error)}</Text>
        )}
      </Section>

      {/* ── Devices ── */}
      <Section title="Paired devices">
        {!deviceAdmin.available ? (
          <Text className="text-sm text-muted-foreground">{deviceAdmin.reason}</Text>
        ) : devices.isLoading ? (
          <ActivityIndicator color={colors['muted-foreground']} />
        ) : devices.data ? (
          devices.data.map((device) => (
            <View key={device.deviceId} className="flex-row items-center gap-3 py-2">
              <Smartphone size={18} color={colors['muted-foreground']} />
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">{device.deviceName}</Text>
                <Text className="text-xs text-muted-foreground">
                  {device.platform}
                  {device.revokedAt ? ' — revoked' : ''}
                  {device.lastUsedAt
                    ? ` — last used ${new Date(device.lastUsedAt).toLocaleDateString()}`
                    : ''}
                </Text>
              </View>
              {!device.revokedAt ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy === device.deviceId}
                  onPress={() => void revokeDevice(device)}
                  className="rounded-md border border-danger px-3 py-1.5"
                >
                  <Text className="text-xs font-medium text-danger">
                    {busy === device.deviceId ? '…' : 'Revoke'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))
        ) : (
          <Text className="text-sm text-danger">{String(devices.error)}</Text>
        )}
      </Section>

      <Pressable
        accessibilityRole="button"
        onPress={confirmUnpair}
        className="items-center rounded-lg border border-danger px-5 py-4"
      >
        <Text className="font-semibold text-danger">Unpair this device</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View className="gap-3">
      <Text className="text-xs uppercase tracking-wide text-muted-foreground">{title}</Text>
      <View className="gap-3 rounded-lg border border-border bg-card p-4">{children}</View>
    </View>
  );
}

function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}): React.ReactElement {
  return (
    <View className="gap-1">
      <Text className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Text>
      <Text className={`text-sm text-foreground ${mono ? 'font-mono' : ''}`}>{children}</Text>
    </View>
  );
}

function Divider(): React.ReactElement {
  return <View className="h-px bg-border" />;
}

/** Same grouping the pairing screen and the server use, so they can be compared. */
function formatFingerprint(hostId: string): string {
  return (hostId.slice(0, 16).match(/.{1,4}/g) ?? []).join('-').toUpperCase();
}

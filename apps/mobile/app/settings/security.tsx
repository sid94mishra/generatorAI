// ────────────────────────────────────────────────────────────────
// Settings → Security.
//
// The screen that justifies having this app on a phone: what this device is
// allowed to do, how its key is protected, which other devices exist, and
// how to revoke any of them from wherever you happen to be standing.
//
// D1 — built on `Screen` like every other settings page. The root layout
// turns the navigator header off for `settings/*` on the assumption that each
// draws its own collapsing title and back button through `<Screen>`; this one
// used a bare `ScrollView`, so it had no title, no way back, and content
// under the status bar.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  Clock,
  Eye,
  Globe,
  KeyRound,
  Laptop,
  Plug,
  QrCode as QrCodeIcon,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  SquareTerminal,
  Trash2,
} from 'lucide-react-native';

import {
  lastResolvedRequestOf,
  pendingRequestOf,
  useApproveScopeRequest,
  useCancelScopeRequest,
  useDenyScopeRequest,
  useMyScopeRequests,
  usePendingScopeRequests,
  type DeviceScopeRequest,
} from '../../src/api/scopeRequests';
import { useAuth } from '../../src/auth/AuthProvider';
import { revokeDeviceRequest } from '../../src/auth/deviceRequests';
import { requireStepUp } from '../../src/auth/stepUp';
import { describeScope, isSensitiveScope } from '../../src/auth/scopeLabels';
import { matchScopePreset } from '../../src/auth/scopePresets';
import { checkFeature, grantableFeatures, type MobileFeature } from '../../src/auth/featureGate';
import { ActionSheet, ConfirmSheet } from '../../src/components/ui/ActionSheet';
import { EditScopesSheet } from '../../src/components/devices/EditScopesSheet';
import { PairDeviceSheet } from '../../src/components/devices/PairDeviceSheet';
import {
  platformLabel,
  rotateDeviceRequest,
  setDeviceScopesRequest,
} from '../../src/components/devices/deviceAdmin';
import { Button } from '../../src/components/ui/Button';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { Card, Divider, SectionHeader } from '../../src/components/ui/primitives';
import { Screen } from '../../src/components/ui/Screen';
import { Spinner } from '../../src/components/ui/States';
import { Touchable } from '../../src/components/ui/Touchable';
import { useToast } from '../../src/components/ui/Toast';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Short names for the capabilities a user can be granted after pairing. */
const FEATURE_LABELS: Record<MobileFeature, string> = {
  terminal: 'Run terminal commands',
  browser: "Control the agent's browser",
  voice: 'Dictate messages',
  fileUpload: 'Attach and write files',
  runStart: 'Start runs',
  scriptRun: 'Run workflow scripts',
  runControl: 'Pause and cancel runs',
  workflowEdit: 'Edit workflows',
  projectEdit: 'Link codebases',
  codebaseLinkLocal: 'Link a local folder',
  capabilityAdmin: 'Manage MCP servers, agents and extensions',
  computer: 'Watch and approve computer use',
  deviceAdmin: 'Manage other devices',
};

/** The mark for a device's platform in the device and request lists. */
function platformIcon(platform: string | null | undefined): typeof Smartphone {
  switch (platform) {
    case 'web':
      return Globe;
    case 'desktop':
      return Laptop;
    case 'cli':
      return SquareTerminal;
    case 'mcp':
      return Plug;
    default:
      return Smartphone;
  }
}

interface DeviceRecord {
  deviceId: string;
  /** Wire field is `name` (`toPublicDevice` in routes/auth.ts); `deviceName` is derived below. */
  name?: string;
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
  const { state, transport, keyBacking, fetch: authFetch, unpair, refreshPermissions } = useAuth();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  /** Device awaiting the "revoke?" confirmation, or null. */
  const [revoking, setRevoking] = useState<DeviceRecord | null>(null);
  /** Another device's access request awaiting the "approve?" confirmation. */
  const [approving, setApproving] = useState<DeviceScopeRequest | null>(null);
  const [unpairing, setUnpairing] = useState(false);
  /** Device whose actions menu is open. */
  const [managing, setManaging] = useState<DeviceRecord | null>(null);
  /** Device whose scopes are being edited. */
  const [editing, setEditing] = useState<DeviceRecord | null>(null);
  /** Device awaiting the "rotate credentials?" confirmation. */
  const [rotating, setRotating] = useState<DeviceRecord | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  const thisDeviceId = state.status === 'authenticated' ? state.deviceId : null;

  const scopes = state.status === 'authenticated' ? state.scopes : [];
  // Split by consequence, not alphabetically: "can change this machine" is
  // the only division that answers the question this screen is opened with.
  const sensitiveScopes = useMemo(() => scopes.filter(isSensitiveScope), [scopes]);
  const readOnlyScopes = useMemo(() => scopes.filter((scope) => !isSensitiveScope(scope)), [scopes]);
  const [readOpen, setReadOpen] = useState(false);

  // Naming what is MISSING, not just what is held. "Terminal is not enabled"
  // in the workbench was previously the only hint, and it appeared in a
  // different part of the app from the screen that explains permissions.
  const missingCapabilities = useMemo(
    () =>
      grantableFeatures(scopes).map((feature) => ({
        scope: feature,
        label: FEATURE_LABELS[feature],
      })),
    [scopes],
  );

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
      const list = ((await res.json()) as { devices: Array<DeviceRecord & { name?: string }> }).devices;
      // The server publishes `name`; the screen was reading `deviceName` and
      // rendered "Revoke undefined" (Sept 7 live run).
      return list.map((d) => ({ ...d, deviceName: d.deviceName ?? d.name ?? 'Unnamed device' }));
    },
    enabled: deviceAdmin.available,
  });

  // This device's own access requests (plan S2): the row that says "you
  // asked for X on Tuesday and nobody has answered yet", and the Cancel.
  const paired = state.status === 'authenticated';
  const myRequests = useMyScopeRequests(paired);
  const myPending = pendingRequestOf(myRequests.data);
  const myLastAnswer = myPending ? null : lastResolvedRequestOf(myRequests.data);
  const cancelRequest = useCancelScopeRequest();

  // Requests FROM other devices, answerable here because this phone holds
  // admin:devices. Same gate as the device list below.
  const accessRequests = usePendingScopeRequests(deviceAdmin.available);
  const approveRequest = useApproveScopeRequest();
  const denyRequest = useDenyScopeRequest();

  const posture = useQuery({
    queryKey: ['security', 'posture'],
    queryFn: async (): Promise<Posture> => {
      const res = await authFetch('/api/security/posture');
      if (!res.ok) throw new Error(`Posture request failed (${res.status})`);
      return (await res.json()) as Posture;
    },
  });

  /**
   * Revoking a device is destructive and immediate. The user first confirms
   * in a sheet that names the device and the consequence (the same pattern
   * chat deletion uses), and then — where the phone can — proves presence
   * with a biometric check. A phone left unlocked on a desk must not be able
   * to cut off someone's laptop with two taps; a phone WITHOUT a sensor used
   * to get no gate at all, which was the worse of the two.
   */
  const revokeDevice = useCallback(
    async (device: DeviceRecord) => {
      // `requireStepUp` handles the no-biometrics case (device passcode, or
      // an honest allow on a phone with neither) the same way every other
      // sensitive action does, instead of this screen deciding on its own.
      if (!(await requireStepUp(`Confirm revoking ${device.deviceName}`))) return;

      setBusy(device.deviceId);
      try {
        const { path, init } = revokeDeviceRequest(device.deviceId);
        const res = await authFetch(path, init);
        if (!res.ok) throw new Error(`Revoke failed (${res.status})`);
        await queryClient.invalidateQueries({ queryKey: ['auth', 'devices'] });
        toast({ message: `Revoked ${device.deviceName}.`, tone: 'success' });
      } catch (err) {
        toast({
          message: `Could not revoke: ${err instanceof Error ? err.message : String(err)}`,
          tone: 'error',
        });
      } finally {
        setBusy(null);
      }
    },
    [authFetch, queryClient, toast],
  );

  /**
   * Approving another device's request hands it authority — terminal access
   * is remote code execution — so it takes the same two steps as revoking:
   * a sheet naming the device and what it gets, then a biometric check where
   * the phone has one.
   */
  const approveAccessRequest = useCallback(
    async (request: DeviceScopeRequest) => {
      if (!(await requireStepUp(`Confirm granting access to ${request.deviceName ?? 'this device'}`))) return;
      setBusy(request.requestId);
      try {
        await approveRequest.mutateAsync({ requestId: request.requestId });
        toast({ message: `Approved ${request.deviceName ?? 'the request'}.`, tone: 'success' });
      } catch (err) {
        toast({
          message: `Could not approve: ${err instanceof Error ? err.message : String(err)}`,
          tone: 'error',
        });
      } finally {
        setBusy(null);
      }
    },
    [approveRequest, toast],
  );

  const denyAccessRequest = useCallback(
    async (request: DeviceScopeRequest) => {
      setBusy(request.requestId);
      try {
        await denyRequest.mutateAsync({ requestId: request.requestId });
        toast({ message: `Denied ${request.deviceName ?? 'the request'}.`, tone: 'success' });
      } catch (err) {
        toast({
          message: `Could not deny: ${err instanceof Error ? err.message : String(err)}`,
          tone: 'error',
        });
      } finally {
        setBusy(null);
      }
    },
    [denyRequest, toast],
  );

  const cancelMyRequest = useCallback(
    async (request: DeviceScopeRequest) => {
      setBusy(request.requestId);
      try {
        await cancelRequest.mutateAsync(request.requestId);
        toast({ message: 'Request withdrawn.', tone: 'success' });
      } catch (err) {
        toast({
          message: `Could not cancel: ${err instanceof Error ? err.message : String(err)}`,
          tone: 'error',
        });
      } finally {
        setBusy(null);
      }
    },
    [cancelRequest, toast],
  );

  /**
   * Replace another device's scopes (the endpoint replaces, not merges). The
   * sheet has already stepped up if anything sensitive is being added; the
   * server re-checks that nothing exceeds this phone's own grant.
   */
  const saveDeviceScopes = useCallback(
    async (device: { deviceId: string; deviceName: string }, next: string[]) => {
      try {
        const { path, init } = setDeviceScopesRequest(device.deviceId, next);
        const res = await authFetch(path, init);
        if (!res.ok) throw new Error(await responseError(res, 'Update'));
        await queryClient.invalidateQueries({ queryKey: ['auth', 'devices'] });
        // Editing this phone's own grant: re-mint so the app sees it now.
        if (device.deviceId === thisDeviceId) await refreshPermissions();
        toast({ message: `Updated access for ${device.deviceName}.`, tone: 'success' });
      } catch (err) {
        toast({
          message: `Could not update access: ${err instanceof Error ? err.message : String(err)}`,
          tone: 'error',
        });
        throw err;
      }
    },
    [authFetch, queryClient, refreshPermissions, thisDeviceId, toast],
  );

  /**
   * Rotating ends every session the device holds; it must pair again. For a
   * suspected-lost laptop that should not be revoked outright.
   */
  const rotateDevice = useCallback(
    async (device: DeviceRecord) => {
      if (!(await requireStepUp(`Confirm signing out ${device.deviceName}`))) return;
      setBusy(device.deviceId);
      try {
        const { path, init } = rotateDeviceRequest(device.deviceId);
        const res = await authFetch(path, init);
        if (!res.ok) throw new Error(await responseError(res, 'Rotate'));
        await queryClient.invalidateQueries({ queryKey: ['auth', 'devices'] });
        toast({ message: `Rotated credentials for ${device.deviceName}.`, tone: 'success' });
      } catch (err) {
        toast({
          message: `Could not rotate: ${err instanceof Error ? err.message : String(err)}`,
          tone: 'error',
        });
      } finally {
        setBusy(null);
      }
    },
    [authFetch, queryClient, toast],
  );

  /**
   * Re-mint the access token so a capability granted from a trusted device
   * is picked up. Scopes are inside the token; nothing else refreshes them.
   */
  const reloadPermissions = useCallback(async () => {
    setBusy('permissions');
    try {
      await refreshPermissions();
      await queryClient.invalidateQueries({ queryKey: ['security', 'posture'] });
      toast({ message: 'Permissions are up to date.', tone: 'success' });
    } catch (err) {
      toast({
        message: `Could not refresh: ${err instanceof Error ? err.message : String(err)}`,
        tone: 'error',
      });
    } finally {
      setBusy(null);
    }
  }, [refreshPermissions, queryClient, toast]);

  // Both destructive device actions on this screen confirm through the same
  // sheet as chat deletion, so one pattern covers every irreversible action.
  const confirmUnpair = useCallback(() => setUnpairing(true), []);

  const hardwareBacked = keyBacking !== 'software' && keyBacking !== 'web-preview';

  const connectionLabel =
    transport.state === 'connected'
      ? `${transport.kind} — ${transport.endpoint}`
      : transport.state === 'host-mismatch'
        ? 'Blocked: server identity changed'
        : transport.state;

  return (
    <Screen
      title="Security"
      back
      backFallback="/settings"
      onRefresh={() => {
        void devices.refetch();
        void posture.refetch();
        void myRequests.refetch();
        if (deviceAdmin.available) void accessRequests.refetch();
      }}
      refreshing={devices.isFetching || posture.isFetching || myRequests.isFetching}
    >
      {/* ── This device ── */}
      <SectionHeader title="This device" />
      <ListGroup>
        <ListRow
          title={`Key protection: ${KEY_BACKING_LABEL[keyBacking] ?? keyBacking}`}
          subtitle={
            hardwareBacked
              ? 'The signing key cannot leave this device, even if the app is compromised.'
              : 'No secure element available, so the key is stored encrypted but is extractable. Treat this device as lower trust.'
          }
          icon={
            hardwareBacked ? (
              <ShieldCheck size={18} color={colors.success} />
            ) : (
              <ShieldAlert size={18} color={colors.warning} />
            )
          }
        />
        <ListRow
          title="Connection"
          subtitle={connectionLabel}
          icon={<KeyRound size={18} color={colors['muted-foreground']} />}
        />
      </ListGroup>

      {/* ── Permissions ── */}
      <SectionHeader title="What this device can do" />
      <Card className="gap-3 p-4">
        {/* Two groups, not twenty-four undifferentiated bullets. This is the
            screen someone opens when they are worried about what a phone can
            do to their machine, and "can change this machine" is the only
            division that answers that question. The read-only half is
            collapsed because it is long and reassuring, not alarming. */}
        {scopes.length === 0 ? (
          <Text className="text-sm text-muted-foreground">Not paired.</Text>
        ) : (
          <>
            {sensitiveScopes.length > 0 ? (
              <View className="gap-2">
                <View className="flex-row items-center gap-2">
                  <ShieldAlert size={15} color={colors.warning} />
                  <Text className="flex-1 text-sm font-semibold text-foreground">
                    Can change this machine ({sensitiveScopes.length})
                  </Text>
                </View>
                {sensitiveScopes.map((scope) => (
                  <View key={scope} className="flex-row gap-2 pl-1">
                    <Text className="text-warning">•</Text>
                    <View className="flex-1">
                      <Text className="text-sm text-foreground">{describeScope(scope)}</Text>
                      <Text className="font-mono text-xs text-muted-foreground">{scope}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {readOnlyScopes.length > 0 ? (
              <View className="gap-2">
                <Touchable
                  accessibilityLabel={`Can read, ${readOnlyScopes.length} permissions`}
                  accessibilityState={{ expanded: readOpen }}
                  accessibilityHint={readOpen ? 'Collapses the list' : 'Expands the list'}
                  haptic="tap"
                  scale="none"
                  onPress={() => setReadOpen((v) => !v)}
                  className="min-h-11 flex-row items-center gap-2"
                >
                  <Eye size={15} color={colors['muted-foreground']} />
                  <Text className="flex-1 text-sm font-semibold text-foreground">
                    Can read ({readOnlyScopes.length})
                  </Text>
                  <ChevronDown
                    size={16}
                    color={colors['muted-foreground']}
                    style={{ transform: [{ rotate: readOpen ? '180deg' : '0deg' }] }}
                  />
                </Touchable>
                {readOpen
                  ? readOnlyScopes.map((scope) => (
                      <View key={scope} className="flex-row gap-2 pl-1">
                        <Text className="text-muted-foreground">•</Text>
                        <View className="flex-1">
                          <Text className="text-sm text-muted-foreground">{describeScope(scope)}</Text>
                          <Text className="font-mono text-xs text-muted-foreground">{scope}</Text>
                        </View>
                      </View>
                    ))
                  : null}
              </View>
            ) : null}
          </>
        )}

        {missingCapabilities.length > 0 ? (
          <>
            <Divider />
            <Text className="text-sm font-semibold text-muted-foreground">Not granted</Text>
            {missingCapabilities.map((capability) => (
              <View key={capability.scope} className="flex-row gap-2">
                <Text className="text-muted-foreground">•</Text>
                <Text className="flex-1 text-sm text-muted-foreground">{capability.label}</Text>
              </View>
            ))}
          </>
        ) : null}

        <Text className="text-xs leading-relaxed text-muted-foreground">
          Terminal and browser control are withheld from a phone by default. Turn them on where
          GeneratorAI is running — Settings › Security › Paired devices › this device › Capabilities
          — then tap below.
        </Text>

        {/* Scopes travel inside the access token, so a grant made elsewhere
            is invisible here until the token is re-minted. Without this the
            capability appears to have been ignored. */}
        <Button
          label="Check for new permissions"
          variant="secondary"
          full
          loading={busy === 'permissions'}
          onPress={() => void reloadPermissions()}
        />
      </Card>

      {/* ── This device's access request ── */}
      {myPending ? (
        <ListGroup>
          <ListRow
            title="Pending access request"
            subtitle={`Asked ${new Date(myPending.createdAt).toLocaleString()} for: ${myPending.scopes
              .map(describeScope)
              .join('; ')}. Approve it from a device that manages devices.`}
            icon={<Clock size={18} color={colors.warning} />}
            trailing={
              <Button
                label="Cancel"
                variant="secondary"
                size="sm"
                haptic="tap"
                loading={busy === myPending.requestId}
                accessibilityLabel="Cancel the pending access request"
                onPress={() => void cancelMyRequest(myPending)}
              />
            }
          />
        </ListGroup>
      ) : myLastAnswer ? (
        <ListGroup>
          <ListRow
            title={
              myLastAnswer.status === 'approved'
                ? 'Last access request approved'
                : 'Last access request denied'
            }
            subtitle={
              myLastAnswer.status === 'approved'
                ? `Granted ${(myLastAnswer.grantedScopes ?? myLastAnswer.scopes)
                    .map(describeScope)
                    .join('; ')}. Tap "Check for new permissions" above if it is not active yet.`
                : `${myLastAnswer.resolutionNote ? `"${myLastAnswer.resolutionNote}" — ` : ''}You can ask again with a different reason.`
            }
            icon={
              myLastAnswer.status === 'approved' ? (
                <ShieldCheck size={18} color={colors.success} />
              ) : (
                <ShieldAlert size={18} color={colors['muted-foreground']} />
              )
            }
          />
        </ListGroup>
      ) : null}

      {/* ── Server posture ── */}
      <SectionHeader title="Server" />
      <Card className="gap-3 p-4">
        {posture.isLoading ? (
          <Spinner />
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
              <View className="gap-2">
                {posture.data.warnings.map((w) => (
                  <View
                    key={w.code}
                    className={`rounded-2xl border p-3 ${
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
      </Card>

      {/* ── Access requests from other devices (admin:devices) ── */}
      {deviceAdmin.available && (accessRequests.data?.length ?? 0) > 0 ? (
        <>
          <SectionHeader title="Access requests" />
          <ListGroup>
            {(accessRequests.data ?? []).map((request) => (
              <ListRow
                key={request.requestId}
                title={request.deviceName ?? 'Unnamed device'}
                subtitle={[
                  platformLabel(request.platform),
                  `wants: ${request.scopes.map(describeScope).join('; ')}`,
                  request.reason ? `“${request.reason}”` : null,
                ]
                  .filter(Boolean)
                  .join(' — ')}
                icon={React.createElement(platformIcon(request.platform), { size: 18, color: colors.warning })}
                trailing={
                  <View className="flex-row gap-2">
                    <Button
                      label="Deny"
                      variant="secondary"
                      size="sm"
                      haptic="tap"
                      disabled={busy === request.requestId}
                      accessibilityLabel={`Deny access request from ${request.deviceName ?? 'device'}`}
                      onPress={() => void denyAccessRequest(request)}
                    />
                    <Button
                      label="Approve"
                      size="sm"
                      loading={busy === request.requestId}
                      accessibilityLabel={`Approve access request from ${request.deviceName ?? 'device'}`}
                      onPress={() => setApproving(request)}
                    />
                  </View>
                }
              />
            ))}
          </ListGroup>
        </>
      ) : null}

      {/* ── Devices ── */}
      <SectionHeader title="Paired devices" />
      {!deviceAdmin.available ? (
        <Card className="p-4">
          <Text className="text-sm text-muted-foreground">{deviceAdmin.reason}</Text>
        </Card>
      ) : devices.isLoading ? (
        <Card className="items-center p-4">
          <Spinner />
        </Card>
      ) : devices.data ? (
        <>
          <ListGroup>
            {devices.data.map((device) => {
              const isThis = device.deviceId === thisDeviceId;
              const access = matchScopePreset(device.scopes)?.label ?? `${device.scopes.length} permissions`;
              return (
                <ListRow
                  key={device.deviceId}
                  title={isThis ? `${device.deviceName} (this device)` : device.deviceName}
                  subtitle={[
                    platformLabel(device.platform),
                    device.revokedAt ? 'revoked' : access,
                    device.lastUsedAt
                      ? `last used ${new Date(device.lastUsedAt).toLocaleDateString()}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' — ')}
                  icon={React.createElement(platformIcon(device.platform), {
                    size: 18,
                    color: colors['muted-foreground'],
                  })}
                  trailing={busy === device.deviceId ? <Spinner /> : undefined}
                  disabled={Boolean(device.revokedAt)}
                  {...(!device.revokedAt
                    ? { onPress: () => setManaging(device) }
                    : {})}
                  accessibilityLabel={`${device.deviceName}${isThis ? ', this device' : ''}, ${
                    device.revokedAt ? 'revoked' : access
                  }`}
                  accessibilityHint={device.revokedAt ? undefined : 'Edit access, rotate or revoke'}
                />
              );
            })}
          </ListGroup>
          <Button
            label="Pair a device"
            variant="secondary"
            full
            icon={<QrCodeIcon size={16} color={colors.foreground} />}
            onPress={() => setPairingOpen(true)}
          />
        </>
      ) : (
        <Card className="p-4">
          <Text className="text-sm text-danger">{String(devices.error)}</Text>
        </Card>
      )}

      <View className="pt-2">
        <Button label="Unpair this device" variant="danger" full onPress={confirmUnpair} />
      </View>

      <ConfirmSheet
        visible={revoking !== null}
        onClose={() => setRevoking(null)}
        title={`Revoke “${revoking?.deviceName ?? ''}”?`}
        message="That device loses access immediately and will need a new pairing code to reconnect. This cannot be undone."
        confirmLabel="Revoke device"
        onConfirm={() => {
          const device = revoking;
          setRevoking(null);
          if (device) void revokeDevice(device);
        }}
      />

      <ActionSheet
        visible={managing !== null}
        onClose={() => setManaging(null)}
        title={managing?.deviceName ?? ''}
        message={managing ? `Access: ${matchScopePreset(managing.scopes)?.label ?? 'Custom'}` : undefined}
        actions={
          managing
            ? [
                {
                  label: 'Edit access',
                  icon: <SlidersHorizontal size={18} color={colors.foreground} />,
                  onPress: () => setEditing(managing),
                },
                {
                  label: 'Rotate credentials',
                  icon: <RefreshCcw size={18} color={colors.foreground} />,
                  disabled: managing.deviceId === thisDeviceId,
                  detail:
                    managing.deviceId === thisDeviceId
                      ? 'Not available for the device you are holding'
                      : 'Signs it out everywhere; it must pair again',
                  onPress: () => setRotating(managing),
                },
                {
                  label: `Revoke ${managing.deviceName}`,
                  icon: <Trash2 size={18} color={colors.danger} />,
                  destructive: true,
                  onPress: () => setRevoking(managing),
                },
              ]
            : []
        }
      />

      <EditScopesSheet
        device={editing}
        callerScopes={scopes}
        isThisDevice={editing?.deviceId === thisDeviceId}
        onClose={() => setEditing(null)}
        onSave={saveDeviceScopes}
      />

      <PairDeviceSheet
        visible={pairingOpen}
        callerScopes={scopes}
        onClose={() => setPairingOpen(false)}
        onChanged={() => void queryClient.invalidateQueries({ queryKey: ['auth', 'devices'] })}
      />

      <ConfirmSheet
        visible={rotating !== null}
        onClose={() => setRotating(null)}
        title={`Rotate credentials for “${rotating?.deviceName ?? ''}”?`}
        message="Every session on that device ends now and it will need a new pairing code to reconnect. Its permissions and history are kept."
        confirmLabel="Rotate credentials"
        onConfirm={() => {
          const device = rotating;
          setRotating(null);
          if (device) void rotateDevice(device);
        }}
      />

      <ConfirmSheet
        visible={approving !== null}
        onClose={() => setApproving(null)}
        title={`Grant access to “${approving?.deviceName ?? ''}”?`}
        message={`It will be able to: ${(approving?.scopes ?? [])
          .map(describeScope)
          .join('; ')}. Anything marked sensitive here is a deliberate grant.`}
        confirmLabel="Approve"
        destructive={false}
        onConfirm={() => {
          const request = approving;
          setApproving(null);
          if (request) void approveAccessRequest(request);
        }}
      />

      <ConfirmSheet
        visible={unpairing}
        onClose={() => setUnpairing(false)}
        title="Unpair this device?"
        message="This device will lose access immediately. You will need to scan a new pairing code to reconnect."
        confirmLabel="Unpair"
        onConfirm={() => {
          setUnpairing(false);
          void unpair();
        }}
      />
    </Screen>
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
      <Text className="text-xs font-semibold text-muted-foreground">{label}</Text>
      <Text className={`text-sm text-foreground ${mono ? 'font-mono' : ''}`}>{children}</Text>
    </View>
  );
}

/** The server's error sentence, or a status line when the body is not JSON. */
async function responseError(res: Response, action: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    if (typeof body.error === 'string') return body.error;
    if (body.error?.message) return body.error.message;
  } catch {
    // Non-JSON body.
  }
  return `${action} failed (${res.status})`;
}

/** Same grouping the pairing screen and the server use, so they can be compared. */
function formatFingerprint(hostId: string): string {
  return (hostId.slice(0, 16).match(/.{1,4}/g) ?? []).join('-').toUpperCase();
}

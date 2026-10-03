// Settings › Security & devices (MSetSecurity, MSetSecurityMore, MDF-112; `/settings/security`):
// - This <device>: App lock & privacy (→ its page), the approval key for risky approvals (06 §6.3 — registered here
//   or from the first risky gate; re-register after a biometrics change), what it may do ("n / total" from the live
//   scope lists → the list in the sheet), key protection, and its own pending request (Cancel) or last answer.
// - Servers: every paired server (current ● Connected; others Switch; ⋯ Forget…), "Add server" → pairing.
// - Network exposure: Loopback only / Network from the server; "Restart the server to apply" (no restart button,
//   MG-27); blockers and an environment override explained. `admin:settings`.
// - Access requests (`admin:devices`): each asks for scopes — untick to grant a subset; Approve n (step-up) / Deny.
// - Paired devices (`admin:devices`): name, preset · scopes · last seen, Revoke… (confirm + step-up); "Pair a new
//   device". Without the scope: the request row.
// - Unpair this <device>… (confirm): unregisters push, removes the approval key, forgets the credential.
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { isSensitiveScope, scopeLabel } from '@generatorai/shared/ui-contract';

import { useApprovalSigner } from '../../blocks/GateCard';
import { PAIR_HREF, settingsHref } from '../../blocks/shell/hrefs';
import { useShellStore } from '../../blocks/shell/shellStore';
import { shortAddress } from '../../blocks/ServerSwitcher';
import { usePaneStore } from '../../blocks/WorkspacePane/paneStore';
import { lastResolvedRequestOf, pendingRequestOf, useApproveScopeRequest, useCancelScopeRequest, useDenyScopeRequest, useMyScopeRequests, usePendingScopeRequests, type DeviceScopeRequest } from '../../services/api/scopeRequests';
import { useAuth } from '../../services/auth/AuthProvider';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { usePreferences } from '../../services/prefs/preferences';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { formatRelativeShort } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import { Menu } from '../../ui/native/Menu';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { nouns } from '../../ui/platform/nouns';
import { overflowIcon } from '../../ui/platform/overflow';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Card } from '../../ui/primitives/Card';
import { CheckboxBox } from '../../ui/primitives/Checkbox';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { Pressable } from '../../ui/primitives/Pressable';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { SettingsPage } from './components/SettingsPage';
import { keyProtection, platformView } from './model/deviceView';
import { presetName } from './model/pairingModel';
import { useDeviceWrites, useDevices, useForgetThisDevice, useNetworkAccess, useSelfDevice, useServerScopes, useSetNetworkAccess, type PairedDevice } from './queries';
import { adminWrite, useScopeAccess } from './useSettingsAccess';

type Href = Parameters<typeof router.push>[0];

export const PAIR_DEVICE_HREF = '/settings/security/pair-device';

function ScopeList({ scopes }: { scopes: readonly string[] }): React.ReactElement {
  return (
    <View className="pb-4">
      <ListSection>
        {scopes.map((s) => (
          <ListRow key={s} kind="info" title={scopeLabel(s)} value={s} mono {...(isSensitiveScope(s) ? { badge: <Badge label="Sensitive" icon="warning" tone="outline" size="sm" /> } : {})} />
        ))}
      </ListSection>
    </View>
  );
}

function ApprovalKeyRow(): React.ReactElement {
  const signer = useApprovalSigner();
  const self = useSelfDevice();
  const { refetch } = self;
  useEffect(() => {
    if (!signer.registering) void refetch();
  }, [signer.registering, refetch]);
  const onServer = Boolean(self.data?.approvalKey);
  const Noun = signer.noun.charAt(0).toUpperCase() + signer.noun.slice(1);
  let value = 'Checking…';
  let action: string | null = null;
  switch (signer.readiness) {
    case 'ok':
      value = onServer || !self.data ? `On · ${self.data?.approvalKey?.presence === 'passcode' ? 'passcode' : Noun}` : 'Not registered here';
      action = onServer || !self.data ? null : 'Register';
      break;
    case 'missing':
      value = 'Not set up';
      action = 'Register';
      break;
    case 'invalidated':
      value = `${Noun} changed`;
      action = 'Register again';
      break;
    case 'unsupported':
      value = `Needs ${signer.noun} or a passcode`;
      break;
    case 'unavailable':
      value = 'Update the app';
      break;
    default:
      break;
  }
  return (
    <>
      <ListRow
        kind="info"
        icon="key"
        title="Approval key"
        subtitle={`Risky approvals are signed with ${signer.noun} on this device`}
        badge={action ? <Button label={action} size="sm" variant="tonal" loading={signer.registering} onPress={signer.register} testID="security-approval-register" /> : undefined}
        value={action ? undefined : value}
        testID="security-approval-key"
      />
      {signer.error ? <ListRow kind="info" icon="warning" title={signer.error} /> : null}
    </>
  );
}

function AccessRequestCard({ request }: { request: DeviceScopeRequest }): React.ReactElement {
  const approve = useApproveScopeRequest();
  const deny = useDenyScopeRequest();
  const [picked, setPicked] = useState<string[]>(request.scopes);
  const name = request.deviceName ?? 'A device';
  const run = (kind: 'approve' | 'deny'): void => {
    if (kind === 'deny') {
      void adminWrite(`Deny ${name}`, () => deny.mutateAsync({ requestId: request.requestId }));
      return;
    }
    void adminWrite(`Grant ${picked.length} permission${picked.length === 1 ? '' : 's'} to ${name}`, () => approve.mutateAsync({ requestId: request.requestId, scopes: picked })).then((r) => r && haptic('success'));
  };
  return (
    <Card radius="gate" padding="none" outlined testID={`access-request-${request.requestId}`}>
      <View className="flex-row items-center gap-3 bg-selected px-4 py-3">
        <Icon concept={platformView(request.platform).icon} tone="warn" />
        <View className="flex-1 gap-0.5">
          <Text role="body" weight={600}>
            {name} asks for {request.scopes.length} more
          </Text>
          <Text role="footnote" tone="fg-3">
            {[platformView(request.platform).label, `${formatRelativeShort(new Date(request.createdAt).toISOString())} ago`].join(' · ')}
          </Text>
        </View>
      </View>
      {request.reason ? (
        <Text role="subhead" tone="fg-2" className="px-4 pt-3">
          “{request.reason}”
        </Text>
      ) : null}
      <View className="py-1">
        {request.scopes.map((s) => {
          const on = picked.includes(s);
          return (
            <Pressable
              key={s}
              onPress={() => setPicked((p) => (on ? p.filter((x) => x !== s) : [...p, s]))}
              frame="none"
              haptic="selection"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${scopeLabel(s)}, ${s}${isSensitiveScope(s) ? ', sensitive' : ''}`}
              className="min-h-item flex-row items-center gap-3 px-4"
            >
              <CheckboxBox checked={on} />
              <Text role="body" tone={on ? 'fg' : 'fg-3'}>
                {scopeLabel(s)}
              </Text>
              <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
                {s}
              </Text>
              <View className="flex-1" />
              {isSensitiveScope(s) ? <Badge label="Sensitive" icon="warning" tone="outline" size="sm" /> : null}
            </Pressable>
          );
        })}
      </View>
      <View className="flex-row gap-3 px-4 pb-4 pt-1">
        <View className="flex-1">
          <Button label="Deny" variant="secondary" fullWidth loading={deny.isPending} onPress={() => run('deny')} testID="access-request-deny" />
        </View>
        <View className="flex-1">
          <Button label={`Approve ${picked.length}`} fullWidth disabled={picked.length === 0} loading={approve.isPending} onPress={() => run('approve')} testID="access-request-approve" />
        </View>
      </View>
    </Card>
  );
}

function DeviceRow({ device, self }: { device: PairedDevice; self: boolean }): React.ReactElement {
  const writes = useDeviceWrites();
  const view = platformView(device.platform);
  const seen = device.lastSeenAt ? formatRelativeShort(new Date(device.lastSeenAt).toISOString()) : null;
  const revoke = (): void =>
    void confirm({ title: `Revoke ${device.name}?`, message: 'It is signed out at once and must pair again. Other devices are not affected.', confirmLabel: 'Revoke', destructive: true }).then(
      (ok) => ok && void adminWrite(`Revoke ${device.name}`, () => writes.revoke(device.deviceId)).then(() => haptic('success')),
    );
  return (
    <ListRow
      kind="info"
      icon={view.icon}
      title={device.name}
      subtitle={[self ? `This ${nouns().device}` : presetName(device.scopes), `${device.scopes.length} scopes`, seen].filter(Boolean).join(' · ')}
      {...(self ? {} : { badge: <Button label="Revoke" variant="ghost" size="sm" onPress={revoke} accessibilityLabel={`Revoke ${device.name}`} testID={`device-revoke-${device.deviceId}`} /> })}
      testID={`device-row-${device.deviceId}`}
    />
  );
}

export default function SecurityScreen(): React.ReactElement {
  const { state, servers, serverId, switchServer, unpair, keyBacking, refreshPermissions } = useAuth();
  const scopes = useGrantedScopes();
  const { biometricLock } = usePreferences();
  const sheet = useSheet();
  const n = nouns();
  const settingsAccess = useScopeAccess('admin:settings', 'Change network exposure from this device');
  const devicesAccess = useScopeAccess('admin:devices', 'See and manage paired devices from this device');
  const total = useServerScopes();
  const mine = useMyScopeRequests();
  const myPending = pendingRequestOf(mine.data);
  const myLast = myPending ? null : lastResolvedRequestOf(mine.data);
  const cancel = useCancelScopeRequest();
  const pending = usePendingScopeRequests(devicesAccess.granted);
  const devices = useDevices(devicesAccess.granted);
  const network = useNetworkAccess();
  const setNetwork = useSetNetworkAccess();
  const forget = useForgetThisDevice();
  const thisDeviceId = state.status === 'authenticated' ? state.deviceId : null;
  const key = keyProtection(keyBacking);
  const active = useMemo(() => (devices.data ?? []).filter((d) => d.revokedAt == null), [devices.data]);
  const revokedCount = (devices.data ?? []).length - active.length;

  const switchTo = (id: string): void => {
    usePaneStore.getState().setOpen(false);
    useShellStore.getState().setDrawerOpen(false);
    switchServer(id).catch((e: unknown) => toast({ kind: 'error', message: e instanceof Error ? e.message : "Couldn't switch server" }));
  };
  const forgetServer = (id: string, label: string): void =>
    void confirm({ title: `Forget ${label}?`, message: 'This device forgets its credential for that server. Pair again to use it.', confirmLabel: 'Forget', destructive: true }).then((ok) => ok && void unpair(id));
  const unpairThis = (): void =>
    void confirm({ title: `Unpair this ${n.device}?`, message: 'It forgets this server: notifications stop and you pair again to come back. Other servers stay paired.', confirmLabel: 'Unpair', destructive: true }).then(async (ok) => {
      if (!ok) return;
      await forget();
      await unpair();
      router.replace((servers.length > 1 ? '/' : PAIR_HREF) as Href);
    });
  const setMode = (mode: 'local-only' | 'network-accessible'): void =>
    void adminWrite(mode === 'network-accessible' ? 'Make the server reachable on the network' : 'Make the server loopback only', () => setNetwork.mutateAsync(mode));

  return (
    <SettingsPage
      title="Security & devices"
      onRefresh={async () => {
        await Promise.all([mine.refetch(), network.refetch(), ...(devicesAccess.granted ? [pending.refetch(), devices.refetch()] : [])]);
      }}
      testID="settings-security-screen"
    >
      <ListSection title={`This ${n.device}`}>
        <ListRow kind="navigation" icon="lock" title="App lock & privacy" value={biometricLock ? n.biometric : 'Off'} onPress={() => router.push(settingsHref('app-lock') as Href)} testID="security-app-lock" />
        <ApprovalKeyRow />
        <ListRow
          kind="navigation"
          icon="key"
          title={`What this ${n.device} can do`}
          value={total.data?.length ? `${scopes.length} / ${total.data.length}` : String(scopes.length)}
          mono
          onPress={() => sheet.present(<ScopeList scopes={scopes} />, { title: `This ${n.device} can`, detents: ['medium', 'large'], scrollable: true })}
          testID="security-scopes"
        />
        <ListRow kind="value" icon="shield" title="Key protection" subtitle={key.detail} value={key.value} />
        {myPending ? (
          <ListRow
            kind="info"
            icon="hand"
            title="Waiting for approval"
            subtitle={`${myPending.scopes.map(scopeLabel).join(', ')} · requested ${formatRelativeShort(new Date(myPending.createdAt).toISOString())} ago`}
            badge={<Button label="Cancel" variant="ghost" size="sm" loading={cancel.isPending} onPress={() => cancel.mutate(myPending.requestId)} testID="security-cancel-request" />}
            testID="security-my-request"
          />
        ) : myLast ? (
          <ListRow
            kind="info"
            icon={myLast.status === 'approved' ? 'check' : 'x'}
            title={myLast.status === 'approved' ? 'Request approved' : 'Request denied'}
            subtitle={myLast.resolutionNote ?? (myLast.grantedScopes ?? myLast.scopes).map(scopeLabel).join(', ')}
            {...(myLast.status === 'approved' ? { badge: <Button label="Refresh" variant="ghost" size="sm" onPress={() => void refreshPermissions()} /> } : {})}
          />
        ) : null}
      </ListSection>

      <ListSection title="Servers" action={{ label: 'Add server', onPress: () => router.push({ pathname: PAIR_HREF, params: { mode: 'add' } } as never) }} footer="Each server keeps its own credential, so switching back never needs pairing.">
        {servers.map((s) => {
          const current = s.serverId === serverId;
          return (
            <View key={s.serverId} className="flex-row items-center pr-2">
              <View className="flex-1">
                <ListRow
                  kind="info"
                  icon={s.kind === 'local' ? 'computer' : 'server'}
                  title={s.label || 'Server'}
                  subtitle={shortAddress(s.endpoint)}
                  badge={
                    current ? (
                      <View className="flex-row items-center gap-1.5">
                        <StatusDot health="ok" size="sm" />
                        <Text role="footnote" tone="ok">
                          Connected
                        </Text>
                      </View>
                    ) : (
                      <Button label="Switch" variant="secondary" size="sm" onPress={() => switchTo(s.serverId)} accessibilityLabel={`Switch to ${s.label}`} />
                    )
                  }
                  testID={`security-server-${current ? 'current' : s.serverId}`}
                />
              </View>
              {!current ? (
                <Menu
                  items={[{ id: 'forget', label: 'Forget server…', icon: 'trash', destructive: true }]}
                  onSelect={() => forgetServer(s.serverId, s.label || 'this server')}
                  accessibilityLabel={`More for ${s.label}`}
                  trigger={<IconButton icon={overflowIcon} size="sm" label={`More for ${s.label}`} onPress={() => undefined} />}
                />
              ) : null}
            </View>
          );
        })}
      </ListSection>

      {network.data ? (
        <View className="gap-2 px-4">
          <Text role="subhead" weight={600}>
            Network exposure
          </Text>
          {settingsAccess.granted && !network.data.envOverride ? (
            <SegmentedControl
              accessibilityLabel="Network exposure"
              value={network.data.mode}
              onValueChange={setMode}
              segments={[
                { value: 'local-only', label: 'Loopback only' },
                { value: 'network-accessible', label: 'Network' },
              ]}
              fullWidth
              testID="security-exposure"
            />
          ) : (
            <ListRow kind="value" icon="link" title="Exposure" value={network.data.mode === 'network-accessible' ? 'Network' : 'Loopback only'} />
          )}
          {network.data.envOverride ? <Callout tone="info" title={`Set by GENERATORAI_BIND_HOST (${network.data.envOverride})`} body="Change it in the server's environment." /> : null}
          {network.data.pendingRestart ? (
            <Callout tone="warn" title="Restart the server to apply" body={network.data.mode === 'network-accessible' ? 'Devices on this network will reach it after a restart; they still need a pairing code.' : 'It stops listening on the network after a restart.'} testID="security-restart" />
          ) : network.data.mode === 'network-accessible' ? (
            <Callout tone="warn" title="Reachable on this network" body={`Anything on this network can reach ${network.data.endpoints?.find((e) => e.reachability !== 'loopback')?.origin ?? 'the server'}. Devices still need a pairing code.`} />
          ) : null}
          {network.data.blockers.length && network.data.mode === 'local-only' ? <Callout tone="info" title="Before it can be reachable" body={network.data.blockers.map((b) => b.message).join('\n')} /> : null}
          {!settingsAccess.granted ? (
            <ListSection>
              <ListRow kind="requires-admin" icon="link" title="Change exposure" onPress={settingsAccess.request} testID="security-exposure-requires-admin" />
            </ListSection>
          ) : null}
        </View>
      ) : null}

      {devicesAccess.granted && pending.data?.length ? (
        <View className="gap-2 px-4">
          <View className="flex-row items-center gap-2">
            <Text role="subhead" weight={600} className="flex-1">
              Access requests
            </Text>
            <Badge label={String(pending.data.length)} icon="hand" size="sm" />
          </View>
          {pending.data
            .filter((r) => r.deviceId !== thisDeviceId)
            .map((r) => (
              <AccessRequestCard key={r.requestId} request={r} />
            ))}
          <Text role="footnote" tone="fg-3">
            Untick anything you don't want to grant; the rest is refused.
          </Text>
        </View>
      ) : null}

      {devicesAccess.granted ? (
        <ListSection title="Paired devices" count={active.length} footer={`Each device holds its own key. Revoking one never affects the others.${revokedCount ? ` ${revokedCount} revoked device${revokedCount === 1 ? ' is' : 's are'} hidden.` : ''}`}>
          {active.map((d) => (
            <DeviceRow key={d.deviceId} device={d} self={d.deviceId === thisDeviceId} />
          ))}
          <ListRow kind="navigation" icon="plus" title="Pair a new device" onPress={() => router.push(PAIR_DEVICE_HREF as Href)} testID="security-pair-device" />
        </ListSection>
      ) : (
        <ListSection title="Paired devices">
          <ListRow kind="requires-admin" icon="device" title="Paired devices" onPress={devicesAccess.request} testID="security-devices-requires-admin" />
        </ListSection>
      )}

      <View className="px-4">
        <Button label={`Unpair this ${n.device}`} variant="destructive" size="lg" fullWidth onPress={unpairThis} testID="security-unpair" />
      </View>
    </SettingsPage>
  );
}

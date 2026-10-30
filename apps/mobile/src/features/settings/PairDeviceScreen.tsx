// Pair a new device (MSetPairDevice, MDF-113, MD-35; `/settings/security/pair-device`, `admin:devices`): a code is
// issued on open (step-up) for the chosen preset — the shared presets this device may hand out (MG-23; anything beyond
// its own grant is disabled, no admin preset, MD-30) — and shown as 1 the address to open (Copy), 2 the 12-character
// code in 3 × 4 cells (Copy) with its QR, "Expires in m:ss · n scopes · single use" and Cancel. Changing the preset
// cancels the code and issues a new one. States: generating, active, expired ("New code"), consumed ("<device>
// joined"). No Share (MD-35) and no Device row (the joining device names itself). While a code is live the screen
// blocks screenshots and recordings and keeps the device awake (M9-09, `useSecretReveal`).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SCOPE_PRESETS, type ScopePresetId } from '@generatorai/shared/ui-contract';

import { useGrantedScopes } from '../../services/auth/useCapability';
import { useSecretReveal } from '../../services/native/privacy';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { errorText } from '../../ui/lib/format';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Card } from '../../ui/primitives/Card';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { PairingCodeInput } from '../../ui/primitives/PairingCodeInput';
import { QrCode } from '../../ui/primitives/QrCode';
import { Spinner } from '../../ui/primitives/Spinner';
import { Text } from '../../ui/primitives/Text';
import { SettingsPage } from './components/SettingsPage';
import { formatCountdown, inviteBody, parsePairingInvite, presetById, presetWithinAuthority, secondsRemaining, type PairingInvite } from './model/pairingModel';
import { useDeviceWrites, useDevices, usePendingInvites } from './queries';
import { adminWrite, useScopeAccess } from './useSettingsAccess';

type Phase = { kind: 'idle' } | { kind: 'generating' } | { kind: 'active'; invite: PairingInvite } | { kind: 'failed'; message: string };

function CopyButton({ value, label }: { value: string; label: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? 'check' : 'copy'}
      label={copied ? 'Copied' : `Copy ${label}`}
      size="sm"
      onPress={() =>
        void Clipboard.setStringAsync(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    />
  );
}

export default function PairDeviceScreen(): React.ReactElement {
  const access = useScopeAccess('admin:devices', 'Pair new devices from this device');
  const scopes = useGrantedScopes();
  const writes = useDeviceWrites();
  const allowed = SCOPE_PRESETS.filter((p) => presetWithinAuthority(p, scopes));
  const [presetId, setPresetId] = useState<ScopePresetId>(() => (allowed.find((p) => p.id === 'companion') ?? allowed[0] ?? SCOPE_PRESETS[0]!).id);
  const [phase, setPhase] = useState<Phase>(() => (access.granted ? { kind: 'generating' } : { kind: 'idle' }));
  const [now, setNow] = useState(() => Date.now());
  const issued = phase.kind === 'active' ? phase.invite : null;
  const remaining = issued ? secondsRemaining(issued.expiresAt, now) : 0;
  const pending = usePendingInvites(Boolean(issued) && remaining > 0);
  // A code that leaves the pending list before it expires was redeemed; at zero it expired (both derived).
  const consumed = Boolean(issued && remaining > 0 && pending.data && !pending.isFetching && !pending.data.includes(issued.grantId));
  const expired = Boolean(issued && remaining === 0);
  const live = issued && !consumed && !expired ? issued : null;
  useSecretReveal(live !== null);
  const devices = useDevices(consumed);
  const current = useRef<PairingInvite | null>(null);

  /** Revokes the open code (if any), then issues one for the preset; never sets state before its first await. */
  const create = useCallback(
    async (id: ScopePresetId) => {
      const previous = current.current;
      current.current = null;
      try {
        const made = await adminWrite('Create a pairing code', async () => {
          if (previous) await writes.revokeInvite(previous.grantId).catch(() => undefined);
          return parsePairingInvite(await writes.createInvite(inviteBody(presetById(id))));
        });
        if (made === undefined) return setPhase({ kind: 'idle' });
        if (made === null) return setPhase({ kind: 'failed', message: 'The server sent an incomplete pairing code.' });
        current.current = made;
        setNow(Date.now());
        setPhase({ kind: 'active', invite: made });
      } catch (e) {
        setPhase({ kind: 'failed', message: errorText(e) });
      }
    },
    [writes],
  );
  const issue = (id: ScopePresetId): void => {
    setPhase({ kind: 'generating' });
    void create(id);
  };

  useEffect(() => {
    // Deferred a tick: the request starts from an effect, its state lands from its own callbacks.
    if (access.granted) queueMicrotask(() => void create(presetId));
    return () => {
      const open = current.current;
      if (open) void writes.revokeInvite(open.grantId).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one code on open; the preset change issues the next
  }, [access.granted]);

  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    if (consumed) {
      current.current = null;
      haptic('success');
    }
  }, [consumed]);
  const joined = consumed ? ([...(devices.data ?? [])].sort((a, b) => b.createdAt - a.createdAt)[0]?.name ?? null) : null;

  const choose = (id: ScopePresetId): void => {
    if (id === presetId) return;
    setPresetId(id);
    issue(id);
  };
  const cancel = (): void => {
    const open = current.current;
    current.current = null;
    setPhase({ kind: 'idle' });
    if (open) void writes.revokeInvite(open.grantId).catch(() => undefined);
  };

  return (
    <SettingsPage title="Pair a new device" crumbs={[{ label: 'Security & devices', href: '/settings/security' }]} testID="settings-pair-device-screen">
      {!access.granted ? (
        <ListSection>
          <ListRow kind="requires-admin" icon="device" title="Pair new devices" onPress={access.request} testID="pair-device-requires-admin" />
        </ListSection>
      ) : (
        <>
          <View className="gap-2 px-4">
            <Card radius="group" padding="md" testID="pair-device-card">
              {phase.kind === 'generating' ? (
                <View className="items-center py-8">
                  <Spinner label="Creating a code" />
                </View>
              ) : live ? (
                <View className="gap-4">
                  <View className="gap-1">
                    <Text role="footnote" tone="fg-3">
                      1 On the other device, open
                    </Text>
                    <View className="flex-row items-center gap-2">
                      <Text role="mono" selectable numberOfLines={1} className="flex-1" testID="pair-device-address">
                        {live.joinUrl}
                      </Text>
                      <CopyButton value={live.joinUrl} label="address" />
                    </View>
                  </View>
                  <View className="gap-2">
                    <Text role="footnote" tone="fg-3">
                      2 Enter this code
                    </Text>
                    <PairingCodeInput value={live.shortCode} onChangeText={() => undefined} readOnly testID="pair-device-code" />
                    <View className="flex-row items-center justify-between">
                      <CopyButton value={live.shortCode} label="code" />
                      <QrCode value={live.pairingUrl} size={132} label="Pairing QR code: scan it with the other device" testID="pair-device-qr" />
                    </View>
                  </View>
                  <View className="flex-row items-center gap-1.5">
                    <Icon concept="clock" size={14} tone="fg-3" />
                    <Text role="footnote" tone="fg-3" className="flex-1">
                      Expires in{' '}
                      <Text role="monoSm" tone="fg-2">
                        {formatCountdown(remaining)}
                      </Text>{' '}
                      · {live.requestedScopes.length} scopes · single use
                    </Text>
                    <Button label="Cancel" variant="ghost" size="sm" onPress={cancel} testID="pair-device-cancel" />
                  </View>
                </View>
              ) : consumed ? (
                <View className="gap-3">
                  <Callout tone="ok" title={`${joined ?? 'The device'} joined`} body="It is listed under Paired devices." />
                  <Button label="Pair another device" variant="secondary" onPress={() => issue(presetId)} />
                </View>
              ) : expired ? (
                <View className="gap-3">
                  <Text role="body" weight={600}>
                    Code expired
                  </Text>
                  <Button label="New code" icon="refresh" onPress={() => issue(presetId)} testID="pair-device-new" />
                </View>
              ) : phase.kind === 'failed' ? (
                <View className="gap-3">
                  <Callout tone="err" title="Couldn't create a code" body={phase.message} />
                  <Button label="Try again" onPress={() => issue(presetId)} />
                </View>
              ) : (
                <Button label="Create a code" icon="plus" onPress={() => issue(presetId)} testID="pair-device-create" />
              )}
            </Card>
            <Text role="footnote" tone="fg-3">
              Don't screenshot the code or paste it into a chat.
            </Text>
          </View>

          <ListSection title="Permissions" footer="Changing it issues a new code. The joining device can ask for more later.">
            {SCOPE_PRESETS.map((p) => {
              const ok = allowed.includes(p);
              return (
                <ListRow
                  key={p.id}
                  kind="radio"
                  title={p.label}
                  subtitle={ok ? p.description : "Beyond this device's own access"}
                  selected={presetId === p.id}
                  disabled={!ok || phase.kind === 'generating'}
                  onPress={() => choose(p.id)}
                  testID={`pair-device-preset-${p.id}`}
                />
              );
            })}
          </ListSection>
        </>
      )}
    </SettingsPage>
  );
}

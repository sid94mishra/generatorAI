// Pairing success (MDF-122; `/paired`, after `completePairing`): "Paired with <server>", what this device can do (the
// scopes the server granted, sensitive ones marked), the approval key for risky approvals — registered here once
// (06 §6.3: "registration happens once after pairing, prompted from the first risky gate or Settings › Security") or
// skipped — and Continue → Home.
import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { isSensitiveScope, scopeLabel } from '@generatorai/shared/ui-contract';

import { useApprovalSigner } from '../../blocks/GateCard';
import { useSystemInfo } from '../../blocks/StatsCards';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { nouns } from '../../ui/platform/nouns';
import { Badge } from '../../ui/primitives/Badge';
import { BrandMark } from '../../ui/primitives/BrandMark';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Text } from '../../ui/primitives/Text';

type Href = Parameters<typeof router.replace>[0];

function ApprovalKeyCard(): React.ReactElement | null {
  const signer = useApprovalSigner();
  if (signer.readiness === 'ok') return <Callout tone="ok" title="Risky approvals are set up" body={`They are signed with ${signer.noun} on this device.`} testID="paired-approval-ok" />;
  if (signer.readiness === 'unsupported') return <Callout tone="info" title="Risky approvals need a passcode" body={`Set ${signer.noun} or a passcode on this device to approve shell, network and push permissions from it.`} />;
  if (signer.readiness !== 'missing' && signer.readiness !== 'invalidated') return null;
  return (
    <View className="gap-2 rounded-card-lg border border-line bg-raised p-4" testID="paired-approval-key">
      <Text role="headline" weight={600}>
        Approve risky actions from here
      </Text>
      <Text role="subhead" tone="fg-2">
        Shell, network and push permissions are signed with {signer.noun} on this device. Set it up once now, or later in Settings › Security & devices.
      </Text>
      {signer.error ? (
        <Text role="footnote" tone="err">
          {signer.error}
        </Text>
      ) : null}
      <View className="self-start">
        <Button label="Set up approval key" icon="key" variant="secondary" size="sm" loading={signer.registering} onPress={signer.register} testID="paired-register" />
      </View>
    </View>
  );
}

export default function PairedScreen(): React.ReactElement {
  const scopes = useGrantedScopes();
  const info = useSystemInfo();
  const n = nouns();
  const done = (): void => router.replace('/' as Href);
  return (
    <Screen header={<Header role="detail" title="" />} testID="paired">
      <View className="gap-5 px-4 pb-10 pt-2">
        <View className="gap-3">
          <BrandMark mark="app" size={36} />
          <Text role="largeTitle" weight={600} accessibilityRole="header">
            Paired with {info.data?.serverName ?? 'your server'}
          </Text>
          <Text role="body" tone="fg-2">
            This {n.device} has its own key for this server. Revoke it any time from Settings › Security & devices.
          </Text>
        </View>
        <ListSection title={`This ${n.device} can`} count={scopes.length} footer="Ask for more later from any locked feature or Settings.">
          {scopes.map((s) => (
            <ListRow key={s} kind="info" title={scopeLabel(s)} {...(isSensitiveScope(s) ? { badge: <Badge label="Sensitive" icon="warning" tone="outline" size="sm" /> } : {})} />
          ))}
        </ListSection>
        <ApprovalKeyCard />
        <Button label="Continue" size="lg" fullWidth onPress={done} testID="paired-continue" />
      </View>
    </Screen>
  );
}

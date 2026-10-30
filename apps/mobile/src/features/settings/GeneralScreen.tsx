// Settings › General (MSetGeneral, MDF-109; `/settings/general`): the default model for new chats — this device's
// choice (MD-30, "This device"), picked in the `/pickers/model` sheet — the server's default provider (→ Model
// providers), and About: what GeneratorAI is, this app's version and the server's. The Node.js runtime row is not
// rendered (MG-26).
import React from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';

import { settingsHref } from '../../blocks/shell/hrefs';
import { useSystemInfo } from '../../blocks/StatsCards';
import { useAuth } from '../../services/auth/AuthProvider';
import { useDefaultModel } from '../../services/prefs/defaultModel';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { nouns } from '../../ui/platform/nouns';
import { Badge } from '../../ui/primitives/Badge';
import { Text } from '../../ui/primitives/Text';
import { SettingsPage } from './components/SettingsPage';
import { useProvidersLive } from './queries';

type Href = Parameters<typeof router.push>[0];

export const DEFAULT_MODEL_PICKER_HREF = '/pickers/model?for=default';

export default function GeneralScreen(): React.ReactElement {
  const { serverId } = useAuth();
  const current = useDefaultModel(serverId);
  const providers = useProvidersLive();
  const info = useSystemInfo();
  const all = providers.data?.providers ?? [];
  const model = current ? all.flatMap((p) => p.models).find((m) => m.id === current.model) : undefined;
  const primary = all.find((p) => p.type === providers.data?.primary);
  const noneReady = providers.data && !all.some((p) => p.ready);
  const device = nouns().device;

  return (
    <SettingsPage title="General" intro={`Preferences for this ${device} and what GeneratorAI is.`} onRefresh={async () => void (await providers.refetch())} testID="settings-general-screen">
      <ListSection title="Default model for new chats" footer={noneReady ? 'No provider is connected yet — sign one in under Model providers.' : `Pre-selects this model when you start a chat on this ${device}. You can still change it per chat.`}>
        <ListRow
          kind="navigation"
          icon="model"
          title="Model"
          subtitle="From any connected provider"
          value={model?.name ?? (current ? current.model : 'Server default')}
          provenance={<Badge label="This device" size="sm" />}
          onPress={() => router.push(DEFAULT_MODEL_PICKER_HREF as Href)}
          testID="general-default-model"
        />
        <ListRow kind="navigation" icon="server" title="Default provider" subtitle="Used when a request doesn't pick a model" {...(primary ? { value: primary.label } : {})} onPress={() => router.push(settingsHref('providers') as Href)} testID="general-default-provider" />
      </ListSection>

      <ListSection title="About GeneratorAI">
        <View className="px-4 py-3">
          <Text role="subhead" tone="fg-2">
            An autonomous AI agent platform with a provider-agnostic harness — run agents on GitHub Copilot, Claude, Codex and more, with multi-session workflows and live streaming.
          </Text>
        </View>
        <ListRow kind="value" title="App version" value={Constants.expoConfig?.version ?? 'development'} mono copyable testID="general-app-version" />
        {info.data ? <ListRow kind="value" title="Server version" value={info.data.serverVersion} mono copyable testID="general-server-version" /> : null}
        {info.data ? <ListRow kind="value" title="Server" value={info.data.serverName} copyable /> : null}
      </ListSection>
    </SettingsPage>
  );
}

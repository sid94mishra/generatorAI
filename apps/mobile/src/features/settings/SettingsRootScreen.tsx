// Settings (MSettings, MSettingsMore; `/settings`, Header `top`): the server card (name, address, connection, "Switch"
// → the server switcher), "Search settings" (a client index over sections and the words inside them), the four
// groups App / Agents & models / Integrations / System with each row's live value (absent when it cannot be read —
// MD-27), Haptics as an inline switch, the per-device footers, and the version footer. Rows push their section.
import React, { useDeferredValue, useMemo, useState } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { HEALTH, type HealthTone } from '@generatorai/shared';
import { getThemeDef } from '@generatorai/design-tokens';

import { useConnectionHealth } from '../../blocks/ConnectionStatus';
import { SERVERS_HREF } from '../../blocks/shell/hrefs';
import { useSidebarToggle } from '../../blocks/shell/useSidebarToggle';
import { useSystemInfo } from '../../blocks/StatsCards';
import { useMyScopeRequests, usePendingScopeRequests, pendingRequestOf } from '../../services/api/scopeRequests';
import { useAuth } from '../../services/auth/AuthProvider';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { usePreferences } from '../../services/prefs/preferences';
import { useDisabledSkills } from '../../services/prefs/skillPrefs';
import { useDefaultModel } from '../../services/prefs/defaultModel';
import { readNotifyPrefs } from '../../services/notifications/notificationFilter';
import { useNotificationPermission } from '../../services/notifications/permission';
import { prefs } from '../../services/storage/prefs';
import { useTheme } from '../../theme/ThemeProvider';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { nouns } from '../../ui/platform/nouns';
import { Header } from '../../ui/native/router/Header';
import { Button } from '../../ui/primitives/Button';
import { Card } from '../../ui/primitives/Card';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { Icon } from '../../ui/primitives/Icon';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { engineLabel } from './audioModel';
import { SETTINGS_GROUPS, matchedKeyword, searchSettings, settingsEntries, type SettingsEntry } from './model/settingsIndex';
import { useAgentSummaries, useAudioSettings, useComputerUseStatus, useExtensions, useHealth, useMcpServers, useProvidersLive, useRetention, useSourceControlSettings, useSystemArtifacts, useTemplates } from './queries';
import { mcpSwitchValue } from './mcpModel';

type Href = Parameters<typeof router.push>[0];

function ServerCard(): React.ReactElement {
  const info = useSystemInfo();
  const { health, address } = useConnectionHealth();
  const word = health === 'reconnecting' ? `${HEALTH.connection.reconnecting.label}…` : HEALTH.connection[health].label;
  const name = info.data?.serverName ?? 'This server';
  return (
    <View className="px-4">
      <Card radius="group" padding="sm" testID="settings-server-card">
        <View className="flex-row items-center gap-3" accessible accessibilityLabel={[name, address, word].filter(Boolean).join(', ')}>
          <View className="size-11 items-center justify-center rounded-card bg-selected">
            <Icon concept="computer" size={20} tone="fg-2" />
          </View>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text role="headline" weight={600} numberOfLines={1}>
              {name}
            </Text>
            <View className="flex-row items-center gap-1.5">
              {address ? (
                <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
                  {address}
                </Text>
              ) : null}
              <StatusDot health={HEALTH.connection[health].tone} size="sm" />
              <Text role="footnote" tone="fg-2">
                {word}
              </Text>
            </View>
          </View>
          <Button label="Switch" icon="sort" variant="secondary" size="sm" onPress={() => router.push(SERVERS_HREF as Href)} accessibilityLabel="Switch server" testID="settings-switch-server" />
        </View>
      </Card>
    </View>
  );
}

/** "● Healthy" / "✋ 1 request": a glyph + word in the value slot (status is never colour alone, MD-28). */
function ValueMark({ health, icon, label, tone }: { health?: HealthTone; icon?: 'hand'; label: string; tone: 'fg-3' | 'warn' }): React.ReactElement {
  return (
    <View className="flex-row items-center gap-1.5">
      {health ? <StatusDot health={health} size="sm" /> : null}
      {icon ? <Icon concept={icon} size={14} tone={tone} /> : null}
      <Text role="subhead" tone={tone}>
        {label}
      </Text>
    </View>
  );
}

const ofCount = (on: number, total: number): string => `${on} of ${total}`;

/** The live value of each row; `undefined` when it cannot be read (the row then shows none). */
function useRowValues(): { values: Partial<Record<string, string>>; marks: Partial<Record<string, React.ReactElement>> } {
  const { serverId } = useAuth();
  const scopes = useGrantedScopes();
  const deviceAdmin = scopes.includes('admin:devices');
  const { themeId } = useTheme();
  const { biometricLock } = usePreferences();
  const defaultModel = useDefaultModel(serverId);
  const providers = useProvidersLive();
  const agents = useAgentSummaries();
  const artifacts = useSystemArtifacts();
  const disabledSkills = useDisabledSkills();
  const mcp = useMcpServers();
  const templates = useTemplates();
  const scm = useSourceControlSettings();
  const computer = useComputerUseStatus();
  const audio = useAudioSettings();
  const extensions = useExtensions();
  const retention = useRetention();
  const health = useHealth(30_000);
  const pending = usePendingScopeRequests(deviceAdmin);
  const mine = useMyScopeRequests(!deviceAdmin);
  const notifications = useNotificationPermission();

  const values: Partial<Record<string, string>> = {};
  const marks: Partial<Record<string, React.ReactElement>> = {};
  const all = providers.data?.providers ?? [];
  const model = defaultModel ? all.flatMap((p) => p.models).find((m) => m.id === defaultModel.model) : undefined;
  values.general = model?.name ?? (defaultModel ? defaultModel.model : 'Server default');
  values.appearance = getThemeDef(themeId).label;
  values['app-lock'] = biometricLock ? nouns().biometric : 'Off';
  if (notifications.status === 'granted' || notifications.status === 'provisional') {
    const on = readNotifyPrefs((k) => prefs.getString(k));
    const kinds = [on.gates ? 'Approvals' : null, on.runs ? 'runs' : null, on.chats ? 'chats' : null].filter(Boolean).join(', ');
    values.notifications = kinds ? kinds.charAt(0).toUpperCase() + kinds.slice(1) : 'Muted';
  } else if (notifications.status === 'denied' || notifications.status === 'undetermined') values.notifications = 'Off';
  if (providers.data) values.providers = `${ofCount(all.filter((p) => p.ready).length, all.length)} connected`;
  if (agents.data) values.agents = ofCount(agents.data.filter((a) => a.enabled).length, agents.data.length);
  const skills = (artifacts.data ?? []).filter((a) => a.type === 'skill');
  if (artifacts.data) values.skills = ofCount(skills.filter((s) => !disabledSkills.includes(s.id)).length, skills.length);
  if (mcp.data) values.mcp = ofCount(mcp.data.filter(mcpSwitchValue).length, mcp.data.length);
  if (templates.data) values.templates = String(templates.data.length);
  if (scm.data) values['source-control'] = scm.data.settings.accounts.length ? (scm.data.providers[0]?.name ?? 'GitHub') : 'Not connected';
  if (computer.data) values['computer-use'] = computer.data.enabled ? 'On' : 'Off';
  if (audio.data) values.audio = engineLabel(audio.data.sttEngine).replace(' (recommended)', '');
  if (extensions.data) values.extensions = String(extensions.data.length);
  if (retention.data) values.storage = retention.data.enabled ? `${retention.data.retentionDays} days` : 'Off';
  if (health.data) {
    const status = health.data.status === 'ok' ? 'ok' : 'degraded';
    marks.diagnostics = <ValueMark health={HEALTH.server[status].tone} label={HEALTH.server[status].label} tone="fg-3" />;
  }
  const requests = deviceAdmin ? (pending.data?.length ?? 0) : pendingRequestOf(mine.data) ? 1 : 0;
  if (requests > 0) marks.security = <ValueMark icon="hand" label={deviceAdmin ? `${requests} request${requests === 1 ? '' : 's'}` : 'Requested'} tone="warn" />;
  return { values, marks };
}

function SettingsRow({ entry, value, mark, position }: { entry: SettingsEntry; value?: string | undefined; mark?: React.ReactElement | undefined; position?: 'first' | 'middle' | 'last' | 'only' }): React.ReactElement {
  const { haptics, setHaptics } = usePreferences();
  if (entry.id === 'haptics') {
    return <ListRow kind="toggle" icon={entry.icon} title={entry.title} switchValue={haptics} onValueChange={setHaptics} testID="settings-haptics" {...(position ? { position } : {})} />;
  }
  return (
    <ListRow
      kind="navigation"
      icon={entry.icon}
      title={entry.title}
      {...(value ? { value } : {})}
      {...(mark ? { badge: mark } : {})}
      onPress={() => router.push(entry.href as Href)}
      testID={`settings-${entry.id}`}
      {...(position ? { position } : {})}
    />
  );
}

export default function SettingsRootScreen(): React.ReactElement {
  const sidebar = useSidebarToggle();
  const n = nouns();
  const entries = useMemo(() => settingsEntries(`Widgets & ${n.liveActivities}`), [n.liveActivities]);
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search);
  const results = useMemo(() => searchSettings(entries, query), [entries, query]);
  const { values, marks } = useRowValues();
  const info = useSystemInfo();
  const { address } = useConnectionHealth();
  const version = Constants.expoConfig?.version ?? 'development';

  const header = <Header role="top" title="Settings" largeTitle onSidebarToggle={sidebar.onSidebarToggle} sidebarToggleState={sidebar.sidebarToggleState} />;

  return (
    <Screen header={header} background="grouped" testID="settings">
      <View className="gap-4 pb-8 pt-1">
        <ServerCard />
        <View className="px-4">
          <SearchInput value={search} onChangeText={setSearch} placeholder="Search settings" testID="settings-search" />
        </View>
        {query.trim() ? (
          results.length === 0 ? (
            <EmptyState compact icon="search" title="No settings match" description="Try another word, like “theme” or “token”." testID="settings-search-empty" />
          ) : (
            <ListSection title="Results" testID="settings-search-results">
              {results.map((entry) => {
                const hit = matchedKeyword(entry, query);
                const group = SETTINGS_GROUPS.find((g) => g.id === entry.group)?.title ?? '';
                return <ListRow key={entry.id} kind="navigation" icon={entry.icon} title={entry.title} subtitle={hit ? `${group} · ${hit}` : group} onPress={() => (entry.href ? router.push(entry.href as Href) : setSearch(''))} testID={`settings-result-${entry.id}`} />;
              })}
            </ListSection>
          )
        ) : (
          SETTINGS_GROUPS.map((group) => {
            const rows = entries.filter((e) => e.group === group.id);
            const footer =
              group.id === 'app'
                ? 'Notifications, App lock and Haptics are set per device.'
                : group.id === 'system'
                  ? `Widgets & ${n.liveActivities} apply to this ${n.device} only.`
                  : undefined;
            return (
              <ListSection key={group.id} title={group.title} {...(footer ? { footer } : {})} testID={`settings-group-${group.id}`}>
                {rows.map((entry) => (
                  <SettingsRow key={entry.id} entry={entry} value={values[entry.id]} mark={marks[entry.id]} />
                ))}
              </ListSection>
            );
          })
        )}
        <View className="items-center gap-0.5 px-4 pt-2" accessible accessibilityLabel={`GeneratorAI ${version}. Connected to ${info.data?.serverName ?? 'this server'}${address ? ` ${address}` : ''}`}>
          <View className="flex-row items-center gap-1">
            <Text role="footnote" tone="fg-3">
              GeneratorAI
            </Text>
            <Text role="monoSm" tone="fg-3">
              {version}
            </Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Text role="footnote" tone="fg-3">
              Connected to {info.data?.serverName ?? 'this server'}
            </Text>
            {address ? (
              <Text role="monoSm" tone="fg-3">
                · {address}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Screen>
  );
}


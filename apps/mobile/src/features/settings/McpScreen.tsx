// Settings › MCP servers (MSetMcp, MDF-110; `/settings/mcp`): "n of m enabled"; one row per server — name, transport
// badge, neutral "Needs setup" / "Custom" badges (MD-25), the description and a Switch that applies at once
// (optimistic, reverted on error). A server that needs setup opens "Set up <server>" in the sheet (its fields, secrets
// as secure inputs, "n of m required fields filled", Save); custom servers have Edit / Remove… in their menu. Header
// "Add server" → the full-screen add form. Writes need `admin:settings` (else the requires-admin row) and a step-up.
import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { EntityRow } from '../../ui/layout/EntityRow';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { confirm } from '../../ui/native/AlertDialog';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { useSheet } from '../../ui/native/Sheet';
import { Switch } from '../../ui/native/Switch';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { Input } from '../../ui/primitives/Input';
import { KeyValueList } from '../../ui/layout/KeyValueList';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { SettingsPage } from './components/SettingsPage';
import { mcpNeedsConfiguration, mcpSubtitle, mcpSwitchValue, type McpEntryLike } from './mcpModel';
import { missingSetup, setupBody, setupFields, setupProgress, transportLabel } from './model/mcpForm';
import { useMcpServers, useMcpWrites, useToggleSystemMcp } from './queries';
import { adminWrite, useScopeAccess } from './useSettingsAccess';

type Href = Parameters<typeof router.push>[0];

export const MCP_ADD_HREF = '/settings/mcp/add';

function SetupForm({ server, onSaved }: { server: McpEntryLike; onSaved: () => void }): React.ReactElement {
  const writes = useMcpWrites();
  const fields = setupFields(server);
  const missing = missingSetup(server);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const progress = setupProgress(fields, values, missing);
  const save = (): void => {
    if (!server.id) return;
    setSaving(true);
    void adminWrite(`Save the setup of ${server.name}`, () => writes.setup(server.id!, setupBody(fields, values, progress.filled === progress.required)))
      .then((done) => {
        if (done === undefined) return;
        haptic('success');
        onSaved();
      })
      .finally(() => setSaving(false));
  };
  return (
    <View className="gap-4 pb-4">
      {server.command || server.url ? (
        <View className="rounded-card bg-sunken p-3">
          <KeyValueList
            items={[
              ...(server.command ? [{ label: 'Command', value: server.command, mono: true }] : []),
              ...(server.args?.length ? [{ label: 'Args', value: server.args.join(' '), mono: true }] : []),
              ...(server.url ? [{ label: 'URL', value: server.url, mono: true }] : []),
              { label: 'Source', value: server.source ?? 'system', mono: true },
            ]}
          />
        </View>
      ) : null}
      {fields.length === 0 ? (
        <Text role="subhead" tone="fg-2">
          This server has nothing to fill in here. Finish it on the desktop app.
        </Text>
      ) : (
        <View className="gap-3">
          {fields.map((f) => (
            <View key={f.id} className="gap-1">
              <Input
                label={f.label}
                value={values[f.id] ?? f.initial}
                onChangeText={(v) => setValues((prev) => ({ ...prev, [f.id]: v }))}
                kind={f.secret ? 'secret' : 'mono'}
                presentation="standalone"
                {...(f.placeholder ? { placeholder: f.placeholder } : {})}
                testID={`mcp-setup-${f.id}`}
              />
              {f.description ? (
                <Text role="footnote" tone="fg-3">
                  {f.description}
                </Text>
              ) : null}
            </View>
          ))}
          <Text role="footnote" tone="fg-3">
            {progress.filled} of {progress.required} required field{progress.required === 1 ? '' : 's'} filled. Secrets are stored in the server's vault and never shown again.
          </Text>
        </View>
      )}
      {fields.length ? <Button label="Save" size="lg" fullWidth loading={saving} onPress={save} testID="mcp-setup-save" /> : null}
    </View>
  );
}

function McpRow({ server, canWrite, onSetup }: { server: McpEntryLike; canWrite: boolean; onSetup: () => void }): React.ReactElement {
  const writes = useMcpWrites();
  const toggle = useToggleSystemMcp({});
  const on = mcpSwitchValue(server);
  const setup = mcpNeedsConfiguration(server);
  const custom = server.source === 'custom';
  const switchable = canWrite && (server.source === 'system' || custom) && Boolean(server.id);
  const menu: MenuEntry[] = custom && canWrite ? [{ id: 'edit', label: 'Edit', icon: 'edit' }, { id: 'remove', label: 'Remove…', icon: 'trash', destructive: true }] : [];
  const onMenu = (id: string): void => {
    if (id === 'edit' && server.id) router.push(`${MCP_ADD_HREF}?edit=${encodeURIComponent(server.id)}` as Href);
    if (id === 'remove' && server.id) {
      void confirm({ title: `Remove ${server.name}?`, message: 'Agents and chats stop using its tools. Its stored secrets are deleted.', confirmLabel: 'Remove', destructive: true }).then((ok) => {
        if (ok) void adminWrite(`Remove ${server.name}`, () => writes.removeCustom(server.id!));
      });
    }
  };
  const setValue = (enabled: boolean): void => {
    if (enabled && setup) return onSetup();
    void adminWrite(`${enabled ? 'Turn on' : 'Turn off'} ${server.name}`, () => toggle.mutateAsync({ server, enabled }));
  };
  return (
    <EntityRow
      title={server.name}
      leading={{ icon: 'mcp' }}
      {...(mcpSubtitle(server) ? { description: mcpSubtitle(server)! } : {})}
      meta={[
        <Badge key="t" label={transportLabel(server)} mono size="sm" />,
        ...(setup ? [<Badge key="s" label="Needs setup" icon="warning" size="sm" />] : []),
        ...(custom ? [<Badge key="c" label="Custom" size="sm" />] : []),
      ]}
      metaLabel={[transportLabel(server), setup ? 'needs setup' : '', custom ? 'custom' : '', on ? 'on' : 'off'].filter(Boolean).join(', ')}
      trailing={switchable ? <Switch value={on && !setup} onValueChange={setValue} label={`${server.name} enabled`} pending={toggle.isPending} testID={`mcp-switch-${server.id ?? server.name}`} /> : <Text role="footnote" tone="fg-3">{on ? 'On' : 'Off'}</Text>}
      {...(menu.length ? { menu, onMenuSelect: onMenu } : {})}
      onPress={setup && canWrite ? onSetup : () => undefined}
      testID={`mcp-row-${server.id ?? server.name}`}
    />
  );
}

export default function McpScreen(): React.ReactElement {
  const servers = useMcpServers();
  const access = useScopeAccess('admin:settings', 'Switch and set up MCP servers from this device');
  const sheet = useSheet();
  const list = servers.data ?? [];
  const openSetup = (server: McpEntryLike): void =>
    sheet.present(<SetupForm server={server} onSaved={() => sheet.dismiss()} />, { title: `Set up ${server.name}`, detents: ['large'], scrollable: true, testID: 'mcp-setup-sheet' });

  return (
    <SettingsPage
      title="MCP servers"
      intro="Model Context Protocol servers give agents external tools. Servers you switch off aren't offered to stages or chats."
      actions={access.granted ? [{ id: 'add', icon: 'plus', label: 'Add server', onPress: () => router.push(MCP_ADD_HREF as Href), testID: 'mcp-add' }] : []}
      onRefresh={async () => void (await servers.refetch())}
      state={servers.isError && !servers.data ? { kind: 'error', error: servers.error, onRetry: () => void servers.refetch(), title: "Couldn't load MCP servers" } : { kind: 'ready' }}
      testID="settings-mcp-screen"
    >
      {!access.granted ? (
        <ListSection>
          <ListRow kind="requires-admin" icon="mcp" title="Switch and add servers" onPress={access.request} testID="mcp-requires-admin" />
        </ListSection>
      ) : null}
      {servers.isLoading ? (
        <Skeleton preset="list" count={5} />
      ) : list.length === 0 ? (
        <EmptyState compact copyKey="mcpServers" {...(access.granted ? { action: { label: 'Add server', icon: 'plus' as const, onPress: () => router.push(MCP_ADD_HREF as Href) } } : {})} />
      ) : (
        <ListSection title={`${list.filter(mcpSwitchValue).length} of ${list.length} enabled`}>
          {list.map((s, i) => (
            <McpRow key={s.id ?? `${s.name}-${i}`} server={s} canWrite={access.granted} onSetup={() => openSetup(s)} />
          ))}
        </ListSection>
      )}
    </SettingsPage>
  );
}

// Project › Customization (MProjectCustomization; G-19): Skills / Prompts / Agents / MCP, "n of m enabled" and a
// filter; one row per artifact (system + project, a project one shadowing a system one with the same name) — mono
// name, Project / System, its description, a Switch "offered in this project" (server-side prefs, so every device and
// every chat or run in the project follows it) and ⋯ (View, Delete… for project items). The screen's NewAction
// uploads a skill / prompt / agent file.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { skillHref } from '../../../blocks/shell/hrefs';
import { EntityRow } from '../../../ui/layout/EntityRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { errorText } from '../../../ui/lib/format';
import { confirm } from '../../../ui/native/AlertDialog';
import { Menu } from '../../../ui/native/Menu';
import type { MenuEntry } from '../../../ui/native/Menu/Menu.types';
import { SegmentedControl } from '../../../ui/native/SegmentedControl';
import { Switch } from '../../../ui/native/Switch';
import { overflowIcon } from '../../../ui/platform/overflow';
import { Badge } from '../../../ui/primitives/Badge';
import { EmptyState } from '../../../ui/primitives/EmptyState';
import { ErrorState } from '../../../ui/primitives/ErrorState';
import { IconButton } from '../../../ui/primitives/IconButton';
import { SearchInput } from '../../../ui/primitives/SearchInput';
import { Skeleton } from '../../../ui/primitives/Skeleton';
import { Text } from '../../../ui/primitives/Text';
import { toast } from '../../../ui/primitives/Toast';
import {
  CUSTOMIZATION_KINDS,
  KIND_LABEL,
  KIND_SINGULAR,
  mergeArtifacts,
  prefKey,
  toggleDisabled,
  type CustomizationItem,
  type CustomizationKind,
} from '../model/projectsModel';
import { useArtifactPrefs, useConfigWrites, useCustomization, useSetArtifactEnabled } from '../queries';

type Href = Parameters<typeof router.push>[0];

const KIND_ICON = { skill: 'skills', prompt: 'message', agent: 'agents', mcp: 'mcp' } as const;
const EMPTY_KEY = { skill: 'skills', prompt: 'prompts', agent: 'agents', mcp: 'mcpServers' } as const;

export function CustomizationTab({ projectId, projectName, kind, onKind, canEdit }: { projectId: string; projectName: string; kind: CustomizationKind; onKind: (k: CustomizationKind) => void; canEdit: boolean }): React.ReactElement {
  const { system, project } = useCustomization(projectId, kind, true);
  const prefs = useArtifactPrefs(projectId);
  const setPrefs = useSetArtifactEnabled(projectId);
  const writes = useConfigWrites(projectId);
  const [filter, setFilter] = useState('');

  const items = useMemo(() => mergeArtifacts((system.data ?? []) as never[], (project.data ?? []) as never[], kind), [system.data, project.data, kind]);
  const disabled = useMemo(() => prefs.data?.disabled ?? [], [prefs.data]);
  const off = useMemo(() => new Set(disabled.map((d) => prefKey(d.type, d.id))), [disabled]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q)) : items;
  }, [items, filter]);
  const enabledCount = items.filter((i) => !off.has(prefKey(i.type, i.id))).length;

  const setEnabled = (item: CustomizationItem, enabled: boolean): void =>
    setPrefs.mutate({ disabled: toggleDisabled(disabled, item.type, item.id, enabled) }, { onError: (e) => toast({ kind: 'error', message: errorText(e) }) });
  const open = (item: CustomizationItem): void => {
    if (kind === 'mcp') return;
    router.push(`${skillHref(projectId, item.id)}?source=${item.source}&kind=${kind}` as Href);
  };
  const remove = (item: CustomizationItem): void =>
    void confirm({
      title: `Delete ${item.name}?`,
      message: `The ${KIND_SINGULAR[kind]} is removed from ${projectName} for every chat and run.`,
      confirmLabel: `Delete ${KIND_SINGULAR[kind]}`,
      icon: 'trash',
    }).then((ok) => {
      if (!ok) return;
      (kind === 'mcp' ? writes.removeMcp(item.id) : writes.remove(item.id)).catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
    });

  const loading = system.isLoading || project.isLoading;
  const error = system.error ?? project.error;
  return (
    <View className="gap-3">
      <View className="gap-3 px-4">
        <SegmentedControl<CustomizationKind>
          accessibilityLabel="Kind"
          value={kind}
          onValueChange={onKind}
          segments={CUSTOMIZATION_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k], ...(k === kind && !loading ? { count: items.length } : {}) }))}
          fullWidth
          testID="customization-kind"
        />
        <View className="flex-row items-center gap-3">
          {!loading ? (
            <Text role="footnote" tone="fg-2">
              {`${enabledCount} of ${items.length} enabled`}
            </Text>
          ) : null}
          <View className="flex-1">
            <SearchInput value={filter} onChangeText={setFilter} placeholder={`Filter ${KIND_LABEL[kind].toLowerCase()}`} size="compact" testID="customization-filter" />
          </View>
        </View>
      </View>
      {loading ? (
        <Skeleton preset="list" count={5} />
      ) : error ? (
        <ErrorState title="Couldn't load this list" error={error} onRetry={() => void Promise.all([system.refetch(), project.refetch()])} />
      ) : shown.length === 0 ? (
        filter.trim() ? <EmptyState copyKey="searchResults" /> : <EmptyState copyKey={EMPTY_KEY[kind]} />
      ) : (
        <ListSection>
          {shown.map((item, i) => {
            const enabled = !off.has(prefKey(item.type, item.id));
            const menu: MenuEntry[] = [
              ...(kind !== 'mcp' ? [{ id: 'view', label: 'View', icon: 'view' as const }] : []),
              ...(canEdit && item.source === 'project' ? [{ type: 'separator' as const }, { id: 'delete', label: 'Delete…', icon: 'trash' as const, destructive: true }] : []),
            ];
            const onMenu = (id: string): void => (id === 'view' ? open(item) : remove(item));
            return (
              <EntityRow
                key={`${item.source}:${item.id}`}
                title={item.name}
                titleMono
                leading={{ icon: KIND_ICON[kind] }}
                footer={
                  <>
                    <Badge label={item.source === 'project' ? 'Project' : 'System'} icon={item.source === 'project' ? 'folder-open' : 'shield'} tone="outline" size="sm" />
                    {item.description ? (
                      <Text role="footnote" tone="fg-3" numberOfLines={1} className="shrink">
                        {item.description}
                      </Text>
                    ) : null}
                  </>
                }
                metaLabel={[item.source, item.description, enabled ? 'enabled' : 'disabled'].filter(Boolean).join(', ')}
                trailing={
                  <View className="flex-row items-center gap-1">
                    <Switch value={enabled} onValueChange={(v) => setEnabled(item, v)} label={`${item.name} offered in this project`} disabled={!canEdit} pending={setPrefs.isPending} testID={`customization-switch-${item.id}`} />
                    {menu.length ? <Menu items={menu} onSelect={onMenu} accessibilityLabel={`More for ${item.name}`} trigger={<IconButton icon={overflowIcon} size="sm" label={`More for ${item.name}`} onPress={() => undefined} />} /> : null}
                  </View>
                }
                menu={menu}
                onMenuSelect={onMenu}
                onPress={() => open(item)}
                position={shown.length === 1 ? 'only' : i === 0 ? 'first' : i === shown.length - 1 ? 'last' : 'middle'}
                testID={`customization-row-${item.id}`}
              />
            );
          })}
        </ListSection>
      )}
    </View>
  );
}

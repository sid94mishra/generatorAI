// Scripts (MScripts; M7-04): header "Scripts N" (top) with Reload; the folder line; one row per loaded script — the
// file name (mono), its title, "6 stages · 3 profiles"; the info card (what scripts are, the server opt-in and the
// `write:workflows` scope). Load errors and last runs have no API yet and are not rendered (MD-27).
import React from 'react';
import { View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { router } from 'expo-router';

import { useSidebarToggle } from '../../blocks/shell/useSidebarToggle';
import { EntityRow } from '../../ui/layout/EntityRow';
import { LargeTitle } from '../../ui/layout/LargeTitle';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { errorText } from '../../ui/lib/format';
import { Header } from '../../ui/native/router/Header';
import { Card } from '../../ui/primitives/Card';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { Icon } from '../../ui/primitives/Icon';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { fileName, type ScriptMeta } from './model/scriptView';
import { useScriptWrites, useScripts } from './queries';

type Href = Parameters<typeof router.push>[0];

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

export default function ScriptsScreen(): React.ReactElement {
  const sidebar = useSidebarToggle();
  const scrollY = useSharedValue(0);
  const scripts = useScripts();
  const writes = useScriptWrites('');
  const list = scripts.data ?? [];
  const reload = async (): Promise<void> => {
    try {
      await writes.reloadAll();
      await scripts.refetch();
    } catch (e) {
      toast({ kind: 'error', message: errorText(e) });
    }
  };
  const header = (
    <Header
      role="top"
      title="Scripts"
      count={scripts.data ? list.length : null}
      scroll={scrollY}
      onSidebarToggle={sidebar.onSidebarToggle}
      sidebarToggleState={sidebar.sidebarToggleState}
      actions={[{ id: 'reload', icon: 'refresh', label: 'Reload scripts', onPress: () => void reload(), testID: 'scripts-reload' }]}
    />
  );
  const state = scripts.isLoading
    ? { kind: 'loading' as const, skeleton: <Skeleton preset="list" count={3} /> }
    : scripts.isError
      ? { kind: 'error' as const, error: scripts.error, onRetry: () => void scripts.refetch(), title: "Couldn't load scripts" }
      : { kind: 'ready' as const };
  return (
    <Screen header={header} state={state} onRefresh={reload} testID="scripts">
      <View className="gap-4 pb-8">
        <LargeTitle title="Scripts" count={scripts.data ? list.length : null} />
        <View className="flex-row items-center gap-1.5 px-4">
          <Icon concept="folder-open" size={14} tone="fg-3" />
          <Text role="monoSm" tone="fg-3">
            templates/scripts
          </Text>
        </View>
        {list.length === 0 ? (
          <EmptyState copyKey="scripts" />
        ) : (
          <ListSection>
            {list.map((s: ScriptMeta) => (
              <EntityRow
                key={s.id}
                title={fileName(s)}
                titleMono
                leading={{ icon: 'scripts' }}
                description={s.name}
                meta={[plural(s.stageCount ?? 0, 'stage'), ...(s.profileCount ? [plural(s.profileCount, 'profile')] : [])]}
                onPress={() => router.push(`/scripts/${encodeURIComponent(s.id)}` as Href)}
                testID={`script-row-${s.id}`}
              />
            ))}
          </ListSection>
        )}
        <View className="px-4">
          <Card radius="group">
            <View className="gap-3">
              <View className="flex-row gap-2">
                <Icon concept="info" size={16} tone="fg-3" />
                <Text role="footnote" tone="fg-2" className="flex-1">
                  Scripts are .workflow.mjs files in templates/scripts on the server. They compile to the same graph as the builder; Materialize saves one as a Draft workflow. There's no editor here: change them in your editor, then Reload.
                </Text>
              </View>
              <View className="flex-row gap-2">
                <Icon concept="lock" size={16} tone="fg-3" />
                <Text role="footnote" tone="fg-2" className="flex-1">
                  They run with the server's privileges, so they stay off unless GENERATORAI_ALLOW_WORKFLOW_SCRIPTS is set on the server. Running one needs the write:workflows scope.
                </Text>
              </View>
            </View>
          </Card>
        </View>
      </View>
    </Screen>
  );
}

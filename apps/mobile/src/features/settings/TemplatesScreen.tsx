// Settings › Templates (MSetTemplates, MDF-119; `/settings/templates`): a search, "n templates", one row per template
// (name, description, category, stage count) with "Use"; a row tap previews it in the sheet (description, the stages
// in order, Use). Use creates a workflow from the template and opens it (`write:workflows`, else the request row).
// "Import a workflow from JSON" points at Workflows.
import React, { useDeferredValue, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { WorkflowTemplate } from '@generatorai/workflow-spec';

import { WORKFLOWS_HREF, workflowHref } from '../../blocks/shell/hrefs';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { Icon } from '../../ui/primitives/Icon';
import { Pressable } from '../../ui/primitives/Pressable';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { errorText } from '../../ui/lib/format';
import { SettingsPage } from './components/SettingsPage';
import { useTemplates, useUseTemplate } from './queries';
import { useScopeAccess } from './useSettingsAccess';

type Href = Parameters<typeof router.push>[0];

const stagesLabel = (t: WorkflowTemplate): string => `${t.graph.stages.length} stage${t.graph.stages.length === 1 ? '' : 's'}`;

function TemplatePreview({ template, canUse, onUse }: { template: WorkflowTemplate; canUse: boolean; onUse: () => void }): React.ReactElement {
  return (
    <View className="gap-4 pb-4">
      {template.graph.workflow.description ? (
        <Text role="body" tone="fg-2">
          {template.graph.workflow.description}
        </Text>
      ) : null}
      <View className="flex-row gap-1.5">
        <Badge label={template.category} mono size="sm" />
        <Badge label={stagesLabel(template)} size="sm" />
      </View>
      <ListSection title="Stages">
        {template.graph.stages.map((s, i) => (
          <ListRow key={s.key} kind="info" title={`${i + 1}. ${s.name}`} value={s.key} mono />
        ))}
      </ListSection>
      {canUse ? <Button label="Use template" size="lg" fullWidth onPress={onUse} testID="template-preview-use" /> : null}
    </View>
  );
}

export default function TemplatesScreen(): React.ReactElement {
  const templates = useTemplates();
  const use = useUseTemplate();
  const access = useScopeAccess('write:workflows', 'Create workflows from templates on this device');
  const sheet = useSheet();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search).trim().toLowerCase();
  const all = useMemo(() => templates.data ?? [], [templates.data]);
  const list = useMemo(() => all.filter((t) => !query || `${t.graph.workflow.name} ${t.graph.workflow.description ?? ''}`.toLowerCase().includes(query)), [all, query]);

  const startFrom = (t: WorkflowTemplate): void => {
    sheet.dismiss();
    use.mutate(t.id, {
      onSuccess: (def) => {
        haptic('success');
        router.push(workflowHref(def.id) as Href);
      },
      onError: (e) => toast({ kind: 'error', message: errorText(e) }),
    });
  };
  const preview = (t: WorkflowTemplate): void =>
    sheet.present(<TemplatePreview template={t} canUse={access.granted} onUse={() => startFrom(t)} />, { title: t.graph.workflow.name, detents: ['medium', 'large'], scrollable: true, testID: 'template-preview' });

  return (
    <SettingsPage
      title="Templates"
      intro="Start a new workflow from a ready-made template."
      onRefresh={async () => void (await templates.refetch())}
      state={templates.isError && !templates.data ? { kind: 'error', error: templates.error, onRetry: () => void templates.refetch(), title: "Couldn't load templates" } : { kind: 'ready' }}
      testID="settings-templates-screen"
    >
      <View className="px-4">
        <SearchInput value={search} onChangeText={setSearch} placeholder="Search templates" testID="settings-templates-search" />
      </View>
      {!access.granted ? (
        <ListSection>
          <ListRow kind="requires-admin" icon="workflows" title="Create workflows" onPress={access.request} testID="templates-requires-scope" />
        </ListSection>
      ) : null}
      {templates.isLoading ? (
        <Skeleton preset="list" count={4} />
      ) : list.length === 0 ? (
        query ? <EmptyState compact icon="search" title="No matching templates" /> : <EmptyState compact copyKey="templates" />
      ) : (
        <ListSection title={`${all.length} template${all.length === 1 ? '' : 's'}`}>
          {list.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => preview(t)}
              frame="none"
              accessibilityRole="button"
              accessibilityLabel={`${t.graph.workflow.name}, ${t.category}, ${stagesLabel(t)}. Preview`}
              className="min-h-row-2 flex-row items-center gap-3 px-4 py-3"
              testID={`template-row-${t.id}`}
            >
              <View className="size-10 items-center justify-center rounded-card bg-selected">
                <Icon concept="layout" size={18} tone="fg-2" />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text role="body" weight={500} numberOfLines={1}>
                  {t.graph.workflow.name}
                </Text>
                {t.graph.workflow.description ? (
                  <Text role="footnote" tone="fg-3" numberOfLines={2}>
                    {t.graph.workflow.description}
                  </Text>
                ) : null}
                <View className="flex-row items-center gap-1.5">
                  <Badge label={t.category} mono size="sm" />
                  <Text role="monoSm" tone="fg-3">
                    {stagesLabel(t)}
                  </Text>
                </View>
              </View>
              {access.granted ? <Button label="Use" variant="secondary" size="sm" loading={use.isPending && use.variables === t.id} onPress={() => startFrom(t)} accessibilityLabel={`Use ${t.graph.workflow.name}`} testID={`template-use-${t.id}`} /> : null}
            </Pressable>
          ))}
        </ListSection>
      )}
      <ListSection>
        <ListRow kind="navigation" icon="upload" title="Import a workflow from JSON" subtitle="Opens Workflows" onPress={() => router.push(WORKFLOWS_HREF as Href)} testID="templates-import" />
      </ListSection>
    </SettingsPage>
  );
}

// Version history (`/workflows/[id]/edit/versions`; MWorkflowAgentDraft; WO P01/P07): the versions newest first
// (published vN, test-run pins), the current one marked. Select one → what it changes against the draft and
// "Restore as draft" (its graph replaces the builder draft — one undoable edit; Save commits it). Select two →
// what changed between them.
import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import type { WorkflowDefinitionVersionSummary, WorkflowGraph } from '@generatorai/workflow-spec';

import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { formatRelativeShort } from '../../../ui/lib/format';
import { RouteSheet } from '../../../ui/native/Sheet';
import { Button } from '../../../ui/primitives/Button';
import { EmptyState } from '../../../ui/primitives/EmptyState';
import { ErrorState } from '../../../ui/primitives/ErrorState';
import { Skeleton } from '../../../ui/primitives/Skeleton';
import { Text } from '../../../ui/primitives/Text';
import { toast } from '../../../ui/primitives/Toast';
import { diffLine, graphDiff, type GraphDiff } from '../model/builderModel';
import { useDefinitionVersion, useDefinitionVersions } from '../queries';
import { useBuilderStore } from './builderStore';
import { useBuilderDraft } from './useBuilderDraft';

const close = (): void => {
  if (router.canGoBack()) router.back();
};

const label = (v: WorkflowDefinitionVersionSummary): string => (v.kind === 'published' ? `v${v.version}` : `Test run · v${v.version}`);

function DiffLines({ diff, names }: { diff: GraphDiff; names: (key: string) => string }): React.ReactElement {
  const rows = [
    ...diff.added.map((k) => `+ ${names(k)}`),
    ...diff.removed.map((k) => `− ${names(k)}`),
    ...diff.changed.map((k) => `~ ${names(k)}`),
  ];
  return (
    <View className="gap-1" testID="versions-diff">
      <Text role="subhead" weight={600}>
        {diffLine(diff)}
      </Text>
      {rows.map((r) => (
        <Text key={r} role="monoSm" tone="fg-2">
          {r}
        </Text>
      ))}
    </View>
  );
}

export default function VersionHistorySheet(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { draft } = useBuilderDraft(id);
  const versions = useDefinitionVersions(id);
  const [picked, setPicked] = useState<string[]>([]);
  const a = useDefinitionVersion(id, picked[0] ?? null);
  const b = useDefinitionVersion(id, picked[1] ?? null);
  const list = [...(versions.data ?? [])].sort((x, y) => y.version - x.version || y.createdAt.localeCompare(x.createdAt));
  const current = draft?.base.currentVersionId ?? null;
  const toggle = (vid: string): void => setPicked((p) => (p.includes(vid) ? p.filter((x) => x !== vid) : [...p, vid].slice(-2)));
  const names = (graphs: (WorkflowGraph | undefined)[]) => (key: string) => graphs.map((g) => g?.stages.find((s) => s.key === key)?.name).find(Boolean) ?? key;
  const restore = (): void => {
    if (!a.data) return;
    const graph = a.data.graph;
    useBuilderStore.getState().edit(id, () => graph);
    toast({ kind: 'background', message: `Restored ${label(a.data)} into the draft. Save to keep it.` });
    close();
  };

  let compare: React.ReactNode = null;
  if (picked.length === 1 && a.data && draft) {
    compare = (
      <View className="gap-3">
        <Text role="footnote" tone="fg-3">{`${label(a.data)} → your draft`}</Text>
        <DiffLines diff={graphDiff(a.data.graph, draft.graph)} names={names([draft.graph, a.data.graph])} />
        <Button label="Restore as draft" variant="primary" fullWidth onPress={restore} testID="versions-restore" />
      </View>
    );
  } else if (picked.length === 2 && a.data && b.data) {
    const [older, newer] = a.data.version <= b.data.version ? [a.data, b.data] : [b.data, a.data];
    compare = (
      <View className="gap-3">
        <Text role="footnote" tone="fg-3">{`${label(older)} → ${label(newer)}`}</Text>
        <DiffLines diff={graphDiff(older.graph, newer.graph)} names={names([newer.graph, older.graph])} />
      </View>
    );
  } else if (picked.length) {
    compare = <Skeleton preset="list" count={2} />;
  }

  return (
    <RouteSheet title="Version history" subtitle={picked.length === 2 ? 'Comparing two versions' : 'Select one to restore, two to compare'} onDismiss={close} scrollable navigation={navigation as never} testID="versions-sheet">
      <View className="gap-4 pb-6">
        {versions.isLoading ? <Skeleton preset="list" count={4} /> : null}
        {versions.isError ? <ErrorState title="Couldn't load the versions" error={versions.error} onRetry={() => void versions.refetch()} /> : null}
        {versions.data && !list.length ? <EmptyState title="No versions yet" description="Publishing creates the first version." icon="history" /> : null}
        {list.length ? (
          <ListSection>
            {list.map((v) => (
              <ListRow
                key={v.id}
                kind="check"
                title={label(v)}
                subtitle={`${formatRelativeShort(v.createdAt)}${v.id === current ? ' · current' : ''}`}
                selected={picked.includes(v.id)}
                onPress={() => toggle(v.id)}
                testID={`versions-row-${v.version}`}
              />
            ))}
          </ListSection>
        ) : null}
        {compare}
      </View>
    </RouteSheet>
  );
}

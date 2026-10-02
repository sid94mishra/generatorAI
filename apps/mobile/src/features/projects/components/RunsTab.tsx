// Project › Runs (G-15): the project's workflow runs, newest first — status glyph, run (or workflow) name, the workflow
// · started time; paged. A row opens the run under its workflow (MD-80).
import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { toEpochMs } from '@generatorai/client-core';
import { resolveStatus, type ProjectRunListItem } from '@generatorai/shared';

import { runHref } from '../../../blocks/shell/hrefs';
import { EntityRow } from '../../../ui/layout/EntityRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { Button } from '../../../ui/primitives/Button';
import { EmptyState } from '../../../ui/primitives/EmptyState';
import { ErrorState } from '../../../ui/primitives/ErrorState';
import { Skeleton } from '../../../ui/primitives/Skeleton';
import { useProjectRuns } from '../queries';

type Href = Parameters<typeof router.push>[0];

export function RunsTab({ projectId }: { projectId: string }): React.ReactElement {
  const runs = useProjectRuns(projectId, true);
  if (runs.isLoading) return <Skeleton preset="list" count={4} />;
  if (runs.isError) return <ErrorState title="Couldn't load runs" error={runs.error} onRetry={() => void runs.refetch()} />;
  const rows = runs.data ?? [];
  if (rows.length === 0) return <EmptyState copyKey="runs" />;
  return (
    <View className="gap-3">
      <ListSection>
        {rows.map((run: ProjectRunListItem) => {
          const status = resolveStatus('workflowRun', run.status);
          const at = toEpochMs((run.startedAt ?? run.createdAt) as unknown as string);
          return (
            <EntityRow
              key={run.id}
              title={run.name || run.definitionName}
              leading={{ status: status?.state ?? 'queued' }}
              meta={[...(run.name && run.name !== run.definitionName ? [run.definitionName] : []), ...(status ? [status.label] : [])]}
              {...(at ? { time: new Date(at).toISOString() } : {})}
              onPress={() => router.push(runHref(run.workflowDefinitionId, run.id) as Href)}
              testID={`project-run-${run.id}`}
            />
          );
        })}
      </ListSection>
      {runs.hasNextPage ? <Button label="Show more" variant="ghost" loading={runs.isFetchingNextPage} onPress={() => void runs.fetchNextPage()} /> : null}
    </View>
  );
}

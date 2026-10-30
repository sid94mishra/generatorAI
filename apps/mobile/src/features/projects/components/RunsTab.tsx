// Project › Runs (G-15): the project's workflow runs, newest first, as MB-49 RunRows (status glyph + word, run or
// workflow name, started time, trigger, duration); paged. A row opens the run under its workflow (MD-80).
import React from 'react';
import { View } from 'react-native';
import type { ProjectRunListItem } from '@generatorai/shared';

import { RunRow } from '../../../blocks/RunRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { Button } from '../../../ui/primitives/Button';
import { EmptyState } from '../../../ui/primitives/EmptyState';
import { ErrorState } from '../../../ui/primitives/ErrorState';
import { Skeleton } from '../../../ui/primitives/Skeleton';
import { useProjectRuns } from '../queries';

export function RunsTab({ projectId }: { projectId: string }): React.ReactElement {
  const runs = useProjectRuns(projectId, true);
  if (runs.isLoading) return <Skeleton preset="list" count={4} />;
  if (runs.isError) return <ErrorState title="Couldn't load runs" error={runs.error} onRetry={() => void runs.refetch()} />;
  const rows = runs.data ?? [];
  if (rows.length === 0) return <EmptyState copyKey="runs" />;
  return (
    <View className="gap-3">
      <ListSection>
        {rows.map((run: ProjectRunListItem) => (
          <RunRow key={run.id} run={run as never} context="any" workflowName={run.definitionName} testID={`project-run-${run.id}`} />
        ))}
      </ListSection>
      {runs.hasNextPage ? <Button label="Show more" variant="ghost" loading={runs.isFetchingNextPage} onPress={() => void runs.fetchNextPage()} /> : null}
    </View>
  );
}

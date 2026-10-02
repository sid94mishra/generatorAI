// Project › Pull requests (MD-36, MG-22): Open / Closed / All across the project's codebases — title, "#123 ·
// codebase · author", the state; codebases the host could not list say why. A row opens the PR detail.
import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { PullRequestListState } from '@generatorai/client-core';
import type { ProjectPullRequest, StatusState } from '@generatorai/shared';

import { pullRequestHref } from '../../../blocks/shell/hrefs';
import { EntityRow } from '../../../ui/layout/EntityRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { SegmentedControl } from '../../../ui/native/SegmentedControl';
import { Callout } from '../../../ui/primitives/Callout';
import { EmptyState } from '../../../ui/primitives/EmptyState';
import { ErrorState } from '../../../ui/primitives/ErrorState';
import { Skeleton } from '../../../ui/primitives/Skeleton';
import { useProjectPullRequests } from '../queries';

type Href = Parameters<typeof router.push>[0];

const PR_STATE: Record<ProjectPullRequest['state'], { state: StatusState; label: string }> = {
  open: { state: 'running', label: 'Open' },
  merged: { state: 'succeeded', label: 'Merged' },
  closed: { state: 'skipped', label: 'Closed' },
};

export function PullRequestsTab({ projectId }: { projectId: string }): React.ReactElement {
  const [state, setState] = useState<PullRequestListState>('open');
  const prs = useProjectPullRequests(projectId, state);
  let body: React.ReactNode;
  if (prs.isLoading) body = <Skeleton preset="list" count={4} />;
  else if (prs.isError) body = <ErrorState title="Couldn't load pull requests" error={prs.error} onRetry={() => void prs.refetch()} />;
  else if (!prs.data?.items.length) body = <EmptyState copyKey="pullRequests" />;
  else
    body = (
      <ListSection>
        {prs.data.items.map((pr) => {
          const s = PR_STATE[pr.state] ?? PR_STATE.open;
          return (
            <EntityRow
              key={`${pr.codebaseId}:${pr.number}`}
              title={pr.title}
              leading={{ status: s.state }}
              meta={[`#${pr.number}`, pr.codebaseAlias, ...(pr.author ? [pr.author] : []), pr.draft ? 'Draft' : s.label]}
              {...(pr.updatedAt ? { time: pr.updatedAt } : {})}
              onPress={() => router.push(pullRequestHref(projectId, pr.codebaseId, pr.number) as Href)}
              testID={`project-pr-${pr.codebaseId}-${pr.number}`}
            />
          );
        })}
      </ListSection>
    );
  return (
    <View className="gap-3">
      <View className="px-4">
        <SegmentedControl<PullRequestListState>
          accessibilityLabel="Pull request state"
          value={state}
          onValueChange={setState}
          segments={[
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
          fullWidth
          testID="project-prs-state"
        />
      </View>
      {prs.data?.unavailable.length ? (
        <View className="px-4">
          <Callout tone="warn" title={`${prs.data.unavailable.map((u) => u.alias).join(', ')}: pull requests unavailable`} body={prs.data.unavailable[0]!.reason} />
        </View>
      ) : null}
      {body}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// Project › Pull requests.
//
// Every PR across the project's codebases (`GET /api/projects/:id/
// pull-requests?state=`), grouped by codebase because a PR number only
// means something next to the repository it belongs to.
//
// Codebases the server could not list arrive in `unavailable` with a
// reason — no remote, no connected account. They are rendered rather than
// dropped: a project whose PR list is silently short is worse than one that
// says which repository it could not reach.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { GitPullRequest, TriangleAlert } from 'lucide-react-native';
import type { ProjectPullRequest } from '@generatorai/shared';

import { relativeTime } from '../../../src/components/runs/formatTime';
import { Badge, Card, SectionHeader } from '../../../src/components/ui/primitives';
import { SegmentedControl } from '../../../src/components/ui/SegmentedControl';
import { PlainScroll } from '../../../src/components/ui/Screen';
import { EmptyState, ErrorState } from '../../../src/components/ui/States';
import { SkeletonList } from '../../../src/components/ui/Skeleton';
import { Touchable } from '../../../src/components/ui/Touchable';
import { scmKeys, type PullRequestListState } from '../../../src/components/scm/api';
import { useScmApi } from '../../../src/components/scm/useScmApi';
import {
  PR_STATE_SEGMENTS,
  groupByCodebase,
  matchesState,
  prStateLabel,
  prStateTone,
} from '../../../src/components/scm/prModel';
import { useTheme } from '../../../src/theme/ThemeProvider';

export default function ProjectPullRequestsScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = String(id);
  const navigation = useNavigation();
  const scm = useScmApi();
  const { colors } = useTheme();
  const [state, setState] = useState<PullRequestListState>('open');

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: 'Pull requests' });
  }, [navigation]);

  const prs = useQuery({
    queryKey: scmKeys.projectPullRequests(projectId, state),
    queryFn: () => scm.projectPullRequests(projectId, state),
    staleTime: 30_000,
  });

  const items = (prs.data?.items ?? []).filter((pr) => matchesState(pr, state));
  const groups = groupByCodebase(items);
  const unavailable = prs.data?.unavailable ?? [];

  return (
    <PlainScroll onRefresh={() => void prs.refetch()} refreshing={prs.isFetching && !prs.isLoading}>
      <SegmentedControl
        segments={PR_STATE_SEGMENTS.map((s) => ({ value: s.value, label: s.label }))}
        value={state}
        onChange={setState}
        accessibilityLabel="Pull request state"
      />

      {prs.isLoading ? (
        <SkeletonList rows={4} />
      ) : prs.isError ? (
        <ErrorState
          message="Could not list pull requests for this project."
          onRetry={() => void prs.refetch()}
        />
      ) : items.length === 0 && unavailable.length === 0 ? (
        <EmptyState
          title={state === 'open' ? 'No open pull requests' : 'No pull requests'}
          message="Pull requests opened from a chat or the Changes pane show up here."
          icon={<GitPullRequest size={24} color={colors['muted-foreground']} />}
        />
      ) : (
        groups.map((group) => (
          <View key={group.codebaseId} className="gap-2">
            <SectionHeader title={group.alias} />
            {group.items.map((pr) => (
              <PullRequestCard key={`${pr.codebaseId}#${pr.number}`} pr={pr} projectId={projectId} />
            ))}
          </View>
        ))
      )}

      {unavailable.length > 0 ? (
        <View className="gap-2">
          <SectionHeader title="Not listed" />
          {unavailable.map((row) => (
            <Card key={row.codebaseId} className="flex-row gap-2.5 p-3.5">
              <TriangleAlert size={16} color={colors.warning} />
              <View className="flex-1 gap-0.5">
                <Text className="text-md font-medium text-foreground">{row.alias}</Text>
                <Text className="text-xs leading-relaxed text-muted-foreground">{row.reason}</Text>
              </View>
            </Card>
          ))}
        </View>
      ) : null}
    </PlainScroll>
  );
}

function PullRequestCard({
  pr,
  projectId,
}: {
  pr: ProjectPullRequest;
  projectId: string;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touchable
      accessibilityLabel={`Pull request ${pr.number}: ${pr.title}`}
      haptic="tap"
      scale="large"
      onPress={() =>
        router.push({
          pathname: '/projects/[id]/codebases/[cid]/pull-requests/[number]',
          params: { id: projectId, cid: pr.codebaseId, number: String(pr.number) },
        })
      }
    >
      <Card className="gap-1.5 p-3.5">
        <View className="flex-row items-center gap-2.5">
          <GitPullRequest size={16} color={colors['muted-foreground']} />
          <Text numberOfLines={2} className="flex-1 text-md font-medium text-foreground">
            {pr.title}
          </Text>
          <Badge label={prStateLabel(pr.state, pr.draft)} tone={prStateTone(pr.state)} />
        </View>
        <Text numberOfLines={1} className="text-xs text-muted-foreground">
          #{pr.number} · {pr.head} → {pr.base}
          {pr.author ? ` · ${pr.author}` : ''}
          {pr.updatedAt ? ` · ${relativeTime(pr.updatedAt)}` : ''}
        </Text>
      </Card>
    </Touchable>
  );
}

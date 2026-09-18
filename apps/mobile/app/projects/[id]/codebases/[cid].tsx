// ────────────────────────────────────────────────────────────────
// Project › Codebase.
//
// One linked codebase: where it lives, which branch it is on, whether its
// checkout is ready for source-control work, its branches, and the pull
// requests opened against it, its worktrees, and a read-only file browser.
// With `write:projects` a remote can be fetched, worktrees removed / cleaned
// up and the codebase removed from the project; without it those controls
// point at Request access.
//
// Status and readiness come back as loosely typed payloads; the screen
// shows only the facts `projectModel` can read with confidence and skips
// anything it does not recognise.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Folder, FolderGit2, GitBranch, GitPullRequest, HardDrive, RefreshCw, Trash2 } from 'lucide-react-native';
import { ApiError, queryKeys, request } from '@generatorai/client-core';
import type { RepoReadiness } from '@generatorai/shared';

import { useApi } from '../../../../src/api/useApi';
import { useAdminApi } from '../../../../src/api/useAdminApi';
import { useAuth } from '../../../../src/auth/AuthProvider';
import { relativeTime } from '../../../../src/components/runs/formatTime';
import { usePullRefresh } from '../../../../src/components/runs/usePullRefresh';
import { scmKeys } from '../../../../src/components/scm/api';
import { useScmApi } from '../../../../src/components/scm/useScmApi';
import { matchesState, prStateLabel, prStateTone } from '../../../../src/components/scm/prModel';
import {
  codebaseLocation,
  codebaseStatusTone,
  codebaseTypeLabel,
  isQuietCodebaseStatus,
  orderBranches,
  readinessFacts,
  showsFetchState,
  statusFacts,
} from '../../../../src/components/work/projectModel';
import { Button } from '../../../../src/components/ui/Button';
import { ConfirmSheet } from '../../../../src/components/ui/ActionSheet';
import { CodebaseWorktrees } from '../../../../src/components/projects/CodebaseWorktrees';
import { messageOf } from '../../../../src/components/projects/ProjectActions';
import { useProjectsApi } from '../../../../src/components/projects/useProjectsApi';
import { useFeature } from '../../../../src/components/runs/useFeature';
import { ListGroup, ListRow } from '../../../../src/components/ui/ListRow';
import { PlainScroll } from '../../../../src/components/ui/Screen';
import { Badge, Card, SectionHeader, TONE_TEXT } from '../../../../src/components/ui/primitives';
import { ErrorState } from '../../../../src/components/ui/States';
import { SkeletonCard, SkeletonList } from '../../../../src/components/ui/Skeleton';
import { useToast } from '../../../../src/components/ui/Toast';
import { useTheme } from '../../../../src/theme/ThemeProvider';

const BRANCH_PREVIEW = 5;

export default function CodebaseDetailScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id: string; cid: string }>();
  const projectId = String(params.id);
  const codebaseId = String(params.cid);
  const api = useApi();
  const admin = useAdminApi();
  const scm = useScmApi();
  const auth = useAuth();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const projectsApi = useProjectsApi();
  const projectEdit = useFeature('projectEdit');
  const canFetch = projectEdit.available;

  const project = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => api.projects.get(projectId),
  });
  const codebase = project.data?.codebases.find((c) => c.id === codebaseId);

  const status = useQuery({
    queryKey: queryKeys.codebaseStatus(projectId, codebaseId),
    queryFn: () => admin.projects.codebases.status(projectId, codebaseId),
  });
  const readiness = useQuery({
    queryKey: queryKeys.codebaseReadiness(projectId, codebaseId),
    // 400 means "no local checkout yet" — a state, not a failure.
    queryFn: async (): Promise<RepoReadiness | null> => {
      try {
        return await request<RepoReadiness>(
          auth.fetch,
          `/api/projects/${encodeURIComponent(projectId)}/codebases/${encodeURIComponent(codebaseId)}/readiness`,
        );
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) return null;
        throw err;
      }
    },
    retry: false,
  });
  const branches = useQuery({
    queryKey: queryKeys.codebaseBranches(projectId, codebaseId),
    queryFn: () => admin.projects.codebases.branches(projectId, codebaseId),
    retry: false,
  });
  const prs = useQuery({
    queryKey: scmKeys.projectPullRequests(projectId, 'open'),
    queryFn: () => scm.projectPullRequests(projectId, 'open'),
    staleTime: 30_000,
  });

  const title = codebase?.alias ?? 'Codebase';
  React.useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const { refreshing, onRefresh } = usePullRefresh(() =>
    Promise.all([project.refetch(), status.refetch(), readiness.refetch(), branches.refetch(), prs.refetch()]),
  );

  const fetchRemote = useMutation({
    mutationFn: () => admin.projects.codebases.fetch(projectId, codebaseId),
    onSuccess: () => {
      toast({ message: 'Fetched.', tone: 'success' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.codebaseStatus(projectId, codebaseId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.codebaseBranches(projectId, codebaseId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.codebaseReadiness(projectId, codebaseId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
    onError: (err) =>
      toast({ message: err instanceof Error ? `Fetch failed: ${err.message}` : 'Fetch failed.', tone: 'error' }),
  });

  const unlink = useMutation({
    mutationFn: () => projectsApi.unlinkCodebase(projectId, codebaseId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      toast({ message: 'Codebase removed from the project.', variant: 'success' });
      leave();
    },
    onError: (err) => toast({ message: messageOf(err, 'Could not remove the codebase.'), variant: 'danger' }),
  });

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/projects/[id]', params: { id: projectId } });
  }, [projectId]);

  const branchList = useMemo(
    () => orderBranches(branches.data, readiness.data?.defaultBranch ?? codebase?.defaultBranch),
    [branches.data, readiness.data?.defaultBranch, codebase?.defaultBranch],
  );
  const codebasePrs = useMemo(
    () => (prs.data?.items ?? []).filter((pr) => pr.codebaseId === codebaseId && matchesState(pr, 'open')),
    [prs.data, codebaseId],
  );

  if (project.isLoading) {
    return (
      <View className="gap-3 p-4">
        <SkeletonCard height={120} />
        <SkeletonList rows={3} />
      </View>
    );
  }
  if (project.isError) {
    return <ErrorState message="Could not load this codebase." onRetry={() => void project.refetch()} />;
  }
  if (!codebase) {
    return <ErrorState title="Codebase not found" message="It may have been unlinked from this project." />;
  }

  const location = codebaseLocation(codebase);
  const facts = statusFacts(status.data);
  const currentStatus = facts.status ?? codebase.status;
  const lastFetchedAt =
    (status.data && typeof status.data['lastFetchedAt'] === 'string' ? status.data['lastFetchedAt'] : null) ??
    codebase.lastFetchedAt;
  const readyFacts = readinessFacts(readiness.data);
  const remote = showsFetchState(codebase.type);
  const visibleBranches = showAllBranches ? branchList : branchList.slice(0, BRANCH_PREVIEW);
  const currentBranch = readiness.data?.branch ?? null;
  const defaultBranch = readiness.data?.defaultBranch ?? codebase.defaultBranch ?? null;

  const copyLocation = (): void => {
    if (!location.secondary) return;
    void Clipboard.setStringAsync(location.secondary).then(() =>
      toast({ message: 'Location copied.', tone: 'success' }),
    );
  };

  return (
    <PlainScroll onRefresh={onRefresh} refreshing={refreshing}>
      <Card className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-emphasis">
            {remote ? (
              <FolderGit2 size={18} color={colors['muted-foreground']} />
            ) : (
              <HardDrive size={18} color={colors['muted-foreground']} />
            )}
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-lg font-semibold text-foreground">{codebase.alias}</Text>
            <Text className="text-sm text-muted-foreground">{codebaseTypeLabel(codebase.type)}</Text>
          </View>
          {isQuietCodebaseStatus(currentStatus) ? null : (
            <Badge label={currentStatus!} tone={codebaseStatusTone(currentStatus)} />
          )}
        </View>
        <View className="gap-0.5">
          <Text className="text-md text-foreground">{location.primary}</Text>
          {location.secondary ? (
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              onLongPress={copyLocation}
              suppressHighlighting
              accessibilityHint="Long-press to copy the full location"
              className="font-mono text-sm text-muted-foreground"
            >
              {location.secondary}
            </Text>
          ) : null}
        </View>
        {facts.lastError && currentStatus === 'error' ? (
          <Text className={`text-sm ${TONE_TEXT.danger}`}>{facts.lastError}</Text>
        ) : null}
      </Card>

      <View>
        <SectionHeader title="Checkout" />
        <ListGroup>
          <FactRow label="Default branch" value={defaultBranch ?? 'Unknown'} />
          {currentBranch && currentBranch !== defaultBranch ? (
            <FactRow label="Current branch" value={currentBranch} />
          ) : null}
          {remote ? (
            <FactRow label="Last fetched" value={lastFetchedAt ? relativeTime(lastFetchedAt) : 'Never'} />
          ) : null}
          {readyFacts
            .filter((f) => f.label !== 'Current branch')
            .map((f) => (
              <FactRow key={f.label} label={f.label} value={f.value} tone={f.tone} />
            ))}
          {readiness.isLoading ? <FactRow label="Readiness" value="Checking…" /> : null}
          {readiness.data === null ? <FactRow label="Readiness" value="No local checkout yet" /> : null}
          {readiness.isError ? <FactRow label="Readiness" value="Could not check" /> : null}
        </ListGroup>
      </View>

      {remote ? (
        <View className="gap-1.5">
          <Button
            label="Fetch from remote"
            variant="secondary"
            icon={<RefreshCw size={16} color={colors.foreground} />}
            loading={fetchRemote.isPending}
            disabled={!canFetch}
            onPress={() => fetchRemote.mutate()}
            accessibilityHint={canFetch ? undefined : 'Needs the Manage projects permission'}
          />
          {canFetch ? null : (
            <View className="flex-row items-center gap-3">
              <Text className="flex-1 px-1 text-sm text-muted-foreground">
                Fetching needs permission to manage projects.
              </Text>
              <Button label="Request access" variant="ghost" size="sm" haptic="tap" onPress={projectEdit.requestAccess} />
            </View>
          )}
        </View>
      ) : null}

      <ListGroup>
        <ListRow
          title="Browse files"
          subtitle={remote ? 'Default branch, read-only' : 'Read-only'}
          icon={<Folder size={18} color={colors['muted-foreground']} />}
          onPress={() =>
            router.push({
              pathname: '/projects/[id]/codebases/[cid]/files',
              params: { id: projectId, cid: codebaseId },
            } as never)
          }
        />
      </ListGroup>

      <CodebaseWorktrees projectId={projectId} codebaseId={codebaseId} />

      {branchList.length > 0 ? (
        <View>
          <SectionHeader
            title={`Branches (${branchList.length})`}
            action={
              branchList.length > BRANCH_PREVIEW ? (
                <Button
                  label={showAllBranches ? 'Show fewer' : 'Show all'}
                  variant="ghost"
                  size="sm"
                  haptic="select"
                  onPress={() => setShowAllBranches((v) => !v)}
                />
              ) : undefined
            }
          />
          <ListGroup>
            {visibleBranches.map((name) => (
              <ListRow
                key={name}
                title={name}
                icon={<GitBranch size={18} color={colors['muted-foreground']} />}
                trailing={
                  name === currentBranch ? (
                    <Badge label="Current" />
                  ) : name === defaultBranch ? (
                    <Badge label="Default" />
                  ) : undefined
                }
              />
            ))}
          </ListGroup>
        </View>
      ) : null}

      {prs.isError ? null : (
        <View>
          <SectionHeader title="Open pull requests" />
          {prs.isLoading ? (
            <SkeletonList rows={2} />
          ) : codebasePrs.length === 0 ? (
            <Text className="px-1 py-2 text-sm text-muted-foreground">No open pull requests.</Text>
          ) : (
            <ListGroup>
              {codebasePrs.map((pr) => (
                <ListRow
                  key={pr.number}
                  title={pr.title}
                  subtitle={`#${pr.number} · ${pr.head} → ${pr.base}${pr.updatedAt ? ` · ${relativeTime(pr.updatedAt)}` : ''}`}
                  icon={<GitPullRequest size={18} color={colors['muted-foreground']} />}
                  trailing={
                    pr.draft ? <Badge label={prStateLabel(pr.state, pr.draft)} tone={prStateTone(pr.state)} /> : undefined
                  }
                  onPress={() =>
                    router.push({
                      pathname: '/projects/[id]/codebases/[cid]/pull-requests/[number]',
                      params: { id: projectId, cid: codebaseId, number: String(pr.number) },
                    })
                  }
                />
              ))}
            </ListGroup>
          )}
        </View>
      )}

      {projectEdit.available ? (
        <View className="pt-4">
          <Button
            label="Remove from project"
            variant="secondary"
            icon={<Trash2 size={16} color={colors.danger} />}
            loading={unlink.isPending}
            onPress={() => setConfirmUnlink(true)}
          />
        </View>
      ) : null}

      <ConfirmSheet
        visible={confirmUnlink}
        onClose={() => setConfirmUnlink(false)}
        title={`Remove ${codebase.alias}?`}
        message={
          remote
            ? 'Its clone and every worktree are deleted from your computer. The remote repository is not touched.'
            : 'Its worktrees are deleted. The folder itself stays on your computer.'
        }
        confirmLabel="Remove codebase"
        onConfirm={() => {
          setConfirmUnlink(false);
          unlink.mutate();
        }}
      />
    </PlainScroll>
  );
}

function FactRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONE_TEXT;
}): React.ReactElement {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      className="min-h-11 flex-row items-center justify-between gap-3 px-4 py-2.5"
    >
      <Text className="text-md text-foreground">{label}</Text>
      <Text
        numberOfLines={1}
        className={`flex-shrink text-right text-sm ${tone && tone !== 'neutral' ? TONE_TEXT[tone] : 'text-muted-foreground'}`}
      >
        {value}
      </Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// Project overview.
//
// One screen that answers "what is going on in this project": what needs
// you, the latest chats and runs, the workflows and automations defined for
// it, its codebases and its open pull requests. Each section is a short,
// flat list that hides itself (or shows a single muted line) when empty, so
// a small project is a short screen rather than a stack of empty cards.
//
// The server has no project filter on runs; `projectRuns` derives them from
// the project's workflow ids plus runs tagged with `__projectId`.
//
// Segments: Overview (the above) · Artifacts (project skills / prompts /
// agents / MCP servers) · Settings (name, worktree retention, limits,
// archive / delete). The header "…" opens the same project actions as a
// long-press on the Projects tab. A repository can be added by git URL; the
// project row is polled while a clone runs and the outcome is toasted.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import {
  ChevronRight,
  FolderGit2,
  GitPullRequest,
  HardDrive,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Workflow,
  Zap,
} from 'lucide-react-native';
import { queryKeys, type CodebaseSummary } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { displayChatName } from '../../src/components/common/chatName';
import { relativeTime } from '../../src/components/runs/formatTime';
import { runTitle } from '../../src/components/runs/runModel';
import { statusLabel } from '../../src/components/runs/statusStyle';
import { usePullRefresh } from '../../src/components/runs/usePullRefresh';
import { scmKeys } from '../../src/components/scm/api';
import { useScmApi } from '../../src/components/scm/useScmApi';
import { matchesState, prStateLabel, prStateTone } from '../../src/components/scm/prModel';
import {
  codebaseLocation,
  codebaseStatusTone,
  isQuietCodebaseStatus,
  mostRecent,
  projectRuns,
  runTone,
  runsNeedingYou,
  showsFetchState,
} from '../../src/components/work/projectModel';
import { Button, IconButton } from '../../src/components/ui/Button';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { AddCodebaseSheet } from '../../src/components/projects/AddCodebaseSheet';
import { ProjectActions } from '../../src/components/projects/ProjectActions';
import { ProjectArtifacts } from '../../src/components/projects/ProjectArtifacts';
import { ProjectSettingsForm } from '../../src/components/projects/ProjectSettingsForm';
import type { CodebaseWire, ProjectDetailWire } from '../../src/components/projects/api';
import {
  anyCloning,
  cloneEvents,
  isCloningStatus,
  statusSnapshot,
} from '../../src/components/projects/projectEditModel';
import { useFeature } from '../../src/components/runs/useFeature';
import { Spinner } from '../../src/components/ui/States';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { Badge, Card, SectionHeader, StatusDot } from '../../src/components/ui/primitives';
import { ErrorState } from '../../src/components/ui/States';
import { SkeletonCard, SkeletonList } from '../../src/components/ui/Skeleton';
import { Touchable } from '../../src/components/ui/Touchable';
import { useToast } from '../../src/components/ui/Toast';
import { useTheme } from '../../src/theme/ThemeProvider';

const RECENT_LIMIT = 5;
const PR_LIMIT = 3;

type SectionKey = 'codebases' | 'chats' | 'runs';
type DetailSegment = 'overview' | 'artifacts' | 'settings';

const CLONE_POLL_MS = 3000;

export default function ProjectDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = String(id);
  const api = useApi();
  const scm = useScmApi();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const toast = useToast();
  const projectEdit = useFeature('projectEdit');
  const [segment, setSegment] = useState<DetailSegment>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [addingCodebase, setAddingCodebase] = useState(false);

  const project = useQuery({
    queryKey: queryKeys.project(projectId),
    // The thin client types the row narrowly; the wire carries settings,
    // rootPath and each codebase's lastError too.
    queryFn: () => api.projects.get(projectId) as Promise<unknown> as Promise<ProjectDetailWire>,
    // Follow a clone to its end without the user pulling.
    refetchInterval: (query) => (anyCloning(query.state.data?.codebases) ? CLONE_POLL_MS : false),
  });

  // Toast a clone that finishes while the screen is open.
  const lastStatuses = useRef<Record<string, string | null> | null>(null);
  useEffect(() => {
    const codebases = project.data?.codebases;
    if (!codebases) return;
    if (lastStatuses.current) {
      for (const event of cloneEvents(lastStatuses.current, codebases)) {
        if (event.kind === 'ready') toast({ message: `${event.alias} is ready.`, variant: 'success' });
        else toast({ message: `${event.alias} could not be cloned: ${event.error}`, variant: 'danger', duration: 8000 });
      }
    }
    lastStatuses.current = statusSnapshot(codebases);
  }, [project.data?.codebases, toast]);
  const chats = useQuery({
    queryKey: queryKeys.projectChats(projectId),
    queryFn: () => api.chats.list({ projectId }),
  });
  const workflows = useQuery({
    queryKey: queryKeys.projectWorkflows(projectId),
    queryFn: () => api.workflows.list(projectId),
  });
  const automations = useQuery({
    queryKey: queryKeys.projectAutomations(projectId),
    queryFn: () => api.automations.list(projectId),
  });
  const runs = useQuery({
    queryKey: queryKeys.runs(),
    queryFn: () => api.runs.list(),
  });
  const prs = useQuery({
    queryKey: scmKeys.projectPullRequests(projectId, 'open'),
    queryFn: () => scm.projectPullRequests(projectId, 'open'),
    staleTime: 30_000,
  });

  const loaded = Boolean(project.data);
  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: project.data?.name ?? 'Project',
      headerRight: () =>
        loaded ? (
          <IconButton
            icon={<MoreHorizontal size={20} color={colors.foreground} />}
            accessibilityLabel="Project actions"
            onPress={() => setMenuOpen(true)}
          />
        ) : null,
    });
  }, [navigation, project.data?.name, loaded, colors.foreground]);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/projects');
  }, []);

  const { refreshing, onRefresh } = usePullRefresh(() =>
    Promise.all([
      project.refetch(),
      chats.refetch(),
      workflows.refetch(),
      automations.refetch(),
      runs.refetch(),
      prs.refetch(),
    ]),
  );

  const projectRunList = useMemo(
    () => projectRuns(runs.data ?? [], (workflows.data ?? []).map((w) => w.id), projectId),
    [runs.data, workflows.data, projectId],
  );
  const needsYou = useMemo(() => runsNeedingYou(projectRunList), [projectRunList]);
  const recentRuns = useMemo(() => mostRecent(projectRunList, RECENT_LIMIT), [projectRunList]);
  const recentChats = useMemo(() => mostRecent(chats.data ?? [], RECENT_LIMIT), [chats.data]);
  const openPrs = useMemo(
    () => mostRecent((prs.data?.items ?? []).filter((pr) => matchesState(pr, 'open')), Number.MAX_SAFE_INTEGER),
    [prs.data],
  );

  // Section offsets inside the scroll content, so the count strip can jump.
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<SectionKey, number>>>({});
  const trackSection = (key: SectionKey) => (e: { nativeEvent: { layout: { y: number } } }) => {
    offsets.current[key] = e.nativeEvent.layout.y;
  };
  const scrollTo = useCallback((key: SectionKey) => {
    const y = offsets.current[key];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  }, []);

  const newChat = useMutation({
    mutationFn: () =>
      api.chats.create({ name: `New chat in ${project.data?.name ?? 'project'}`, projectId }),
    onSuccess: (chat) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats() });
      router.push(`/chats/${chat.id}`);
    },
    onError: (err) =>
      Alert.alert('Could not start a chat', err instanceof Error ? err.message : 'Try again in a moment.'),
  });

  if (project.isLoading) {
    return (
      <View className="gap-3 p-4">
        <SkeletonCard height={120} />
        <SkeletonList rows={4} />
      </View>
    );
  }
  if (project.isError || !project.data) {
    return <ErrorState message="Could not load this project." onRetry={() => void project.refetch()} />;
  }

  const codebases = project.data.codebases ?? [];
  const counts: Array<{ key: string; label: string; value: number | null; onPress: () => void }> = [
    { key: 'codebases', label: 'Codebases', value: codebases.length, onPress: () => scrollTo('codebases') },
    { key: 'chats', label: 'Chats', value: chats.data ? chats.data.length : null, onPress: () => scrollTo('chats') },
    { key: 'runs', label: 'Runs', value: runs.data && workflows.data ? projectRunList.length : null, onPress: () => scrollTo('runs') },
    {
      key: 'prs',
      label: 'Open PRs',
      value: prs.data ? openPrs.length : null,
      onPress: () => router.push({ pathname: '/projects/[id]/pull-requests', params: { id: projectId } }),
    },
  ];

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors['muted-foreground']} />
      }
    >
      <SegmentedControl
        segments={[
          { value: 'overview', label: 'Overview' },
          { value: 'artifacts', label: 'Artifacts' },
          { value: 'settings', label: 'Settings' },
        ]}
        value={segment}
        onChange={setSegment}
        accessibilityLabel="Project sections"
      />

      {segment === 'artifacts' ? <ProjectArtifacts projectId={projectId} /> : null}
      {segment === 'settings' ? <ProjectSettingsForm project={project.data} onDeleted={leave} /> : null}

      {segment === 'overview' ? (
      <>
      <Card className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-emphasis">
            <FolderGit2 size={18} color={colors['muted-foreground']} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-lg font-semibold text-foreground">{project.data.name}</Text>
            <Text className="text-sm text-muted-foreground">Created {relativeTime(project.data.createdAt)}</Text>
          </View>
        </View>
        {project.data.description ? (
          <Text className="text-sm leading-relaxed text-muted-foreground">{project.data.description}</Text>
        ) : null}
        <View className="flex-row border-t border-border-muted pt-2">
          {counts.map((c) => (
            <Touchable
              key={c.key}
              accessibilityLabel={`${c.value ?? 'Loading'} ${c.label}`}
              haptic="tap"
              scale="none"
              onPress={c.onPress}
              className="min-h-11 flex-1 items-center justify-center py-1"
            >
              <Text className="text-lg font-semibold text-foreground">{c.value ?? '–'}</Text>
              <Text numberOfLines={1} className="text-sm text-muted-foreground">
                {c.label}
              </Text>
            </Touchable>
          ))}
        </View>
      </Card>

      {needsYou.length > 0 ? (
        <View>
          <SectionHeader title="Needs you" />
          <ListGroup>
            {needsYou.map((run) => (
              <ListRow
                key={run.id}
                title={runTitle(run.name)}
                subtitle={`${statusLabel(run.status)} · ${relativeTime(run.updatedAt)}`}
                icon={<StatusDot tone={runTone(run.status)} label={null} />}
                onPress={() => router.push(`/runs/${run.id}`)}
              />
            ))}
          </ListGroup>
        </View>
      ) : null}

      <View onLayout={trackSection('chats')}>
        <SectionHeader
          title="Recent chats"
          action={
            <Button
              label="New chat"
              variant="ghost"
              size="sm"
              icon={<Plus size={16} color={colors.primary} />}
              loading={newChat.isPending}
              onPress={() => newChat.mutate()}
              accessibilityLabel="New chat in project"
            />
          }
        />
        {chats.isError ? (
          <MutedLine text="Could not load chats." />
        ) : chats.isLoading ? (
          <SkeletonList rows={2} />
        ) : recentChats.length === 0 ? (
          <MutedLine text="No chats in this project yet." />
        ) : (
          <ListGroup>
            {recentChats.map((chat) => (
              <ListRow
                key={chat.id}
                title={displayChatName(chat.name)}
                subtitle={relativeTime(chat.updatedAt)}
                icon={<MessageSquare size={18} color={colors['muted-foreground']} />}
                onPress={() => router.push(`/chats/${chat.id}`)}
              />
            ))}
          </ListGroup>
        )}
      </View>

      <View onLayout={trackSection('runs')}>
        <SectionHeader title="Runs" />
        {runs.isError ? (
          <MutedLine text="Could not load runs." />
        ) : runs.isLoading || workflows.isLoading ? (
          <SkeletonList rows={2} />
        ) : recentRuns.length === 0 ? (
          <MutedLine text="No runs yet." />
        ) : (
          <ListGroup>
            {recentRuns.map((run) => (
              <ListRow
                key={run.id}
                title={runTitle(run.name)}
                subtitle={`${statusLabel(run.status)} · ${relativeTime(run.updatedAt)}`}
                icon={<StatusDot tone={runTone(run.status)} label={null} />}
                onPress={() => router.push(`/runs/${run.id}`)}
              />
            ))}
          </ListGroup>
        )}
      </View>

      {(workflows.data?.length ?? 0) > 0 ? (
        <View>
          <SectionHeader title="Workflows" />
          <ListGroup>
            {workflows.data!.map((wf) => (
              <ListRow
                key={wf.id}
                title={wf.name}
                subtitle={wf.description || null}
                icon={<Workflow size={18} color={colors['muted-foreground']} />}
                onPress={() => router.push(`/workflows/${wf.id}`)}
              />
            ))}
          </ListGroup>
        </View>
      ) : null}

      {(automations.data?.length ?? 0) > 0 ? (
        <View>
          <SectionHeader title="Automations" />
          <ListGroup>
            {automations.data!.map((auto) => (
              <ListRow
                key={auto.id}
                title={auto.name}
                subtitle={
                  auto.lastRunAt ? `${triggerLabel(auto.triggerType)} · ran ${relativeTime(auto.lastRunAt)}` : triggerLabel(auto.triggerType)
                }
                icon={<Zap size={18} color={colors['muted-foreground']} />}
                trailing={auto.enabled ? undefined : <Badge label="Off" />}
                onPress={() => router.push(`/automations/${auto.id}`)}
              />
            ))}
          </ListGroup>
        </View>
      ) : null}

      <View onLayout={trackSection('codebases')}>
        <SectionHeader
          title="Codebases"
          action={
            <Button
              label="Add"
              variant="ghost"
              size="sm"
              haptic="tap"
              icon={<Plus size={16} color={colors.primary} />}
              onPress={() => (projectEdit.available ? setAddingCodebase(true) : projectEdit.requestAccess())}
              accessibilityLabel="Add repository"
              {...(projectEdit.available ? {} : { accessibilityHint: 'Needs project-edit permission; opens Request access' })}
            />
          }
        />
        {codebases.length === 0 ? (
          <MutedLine text="No codebases yet. Add a repository by its git URL." />
        ) : (
          <ListGroup>
            {codebases.map((codebase) => (
              <CodebaseRow key={codebase.id} codebase={codebase} projectId={projectId} />
            ))}
          </ListGroup>
        )}
      </View>

      {prs.isError ? null : (
        <View>
          <SectionHeader
            title="Pull requests"
            action={
              <Button
                label="See all"
                variant="ghost"
                size="sm"
                haptic="tap"
                onPress={() => router.push({ pathname: '/projects/[id]/pull-requests', params: { id: projectId } })}
              />
            }
          />
          {prs.isLoading ? (
            <SkeletonList rows={2} />
          ) : openPrs.length === 0 ? (
            <MutedLine text="No open pull requests." />
          ) : (
            <ListGroup>
              {openPrs.slice(0, PR_LIMIT).map((pr) => (
                <ListRow
                  key={`${pr.codebaseId}#${pr.number}`}
                  title={pr.title}
                  subtitle={`${pr.codebaseAlias} #${pr.number}${pr.updatedAt ? ` · ${relativeTime(pr.updatedAt)}` : ''}`}
                  icon={<GitPullRequest size={18} color={colors['muted-foreground']} />}
                  trailing={pr.draft ? <Badge label={prStateLabel(pr.state, pr.draft)} tone={prStateTone(pr.state)} /> : undefined}
                  onPress={() =>
                    router.push({
                      pathname: '/projects/[id]/codebases/[cid]/pull-requests/[number]',
                      params: { id: projectId, cid: pr.codebaseId, number: String(pr.number) },
                    })
                  }
                />
              ))}
            </ListGroup>
          )}
        </View>
      )}
      </>
      ) : null}

      <ProjectActions project={menuOpen ? project.data : null} onClose={() => setMenuOpen(false)} onDeleted={leave} />
      <AddCodebaseSheet
        visible={addingCodebase}
        onClose={() => setAddingCodebase(false)}
        projectId={projectId}
        existingAliases={codebases.map((c) => c.alias)}
      />
    </ScrollView>
  );
}

function triggerLabel(trigger: string): string {
  if (trigger === 'schedule') return 'Scheduled';
  if (trigger === 'webhook') return 'Webhook';
  return 'Manual';
}

function MutedLine({ text }: { text: string }): React.ReactElement {
  return <Text className="px-1 py-2 text-sm text-muted-foreground">{text}</Text>;
}

function CodebaseRow({ codebase, projectId }: { codebase: CodebaseSummary & Pick<CodebaseWire, 'lastError'>; projectId: string }): React.ReactElement {
  const { colors } = useTheme();
  const toast = useToast();
  const location = codebaseLocation(codebase);
  const remote = codebase.type === 'git-remote';
  const meta = [
    codebase.defaultBranch,
    showsFetchState(codebase.type)
      ? codebase.lastFetchedAt
        ? `fetched ${relativeTime(codebase.lastFetchedAt)}`
        : 'never fetched'
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Touchable
      accessibilityLabel={`Codebase ${codebase.alias}, ${location.primary}`}
      accessibilityHint="Opens the codebase. Long-press to copy its location."
      haptic="tap"
      scale="large"
      onPress={() =>
        router.push({ pathname: '/projects/[id]/codebases/[cid]', params: { id: projectId, cid: codebase.id } })
      }
      onLongPress={
        location.secondary
          ? () =>
              void Clipboard.setStringAsync(location.secondary).then(() =>
                toast({ message: 'Location copied.', tone: 'success' }),
              )
          : undefined
      }
    >
      <View className="min-h-14 flex-row items-center gap-3 px-4 py-2.5">
        <View className="h-9 w-9 items-center justify-center rounded-2xl bg-emphasis">
          {remote ? (
            <FolderGit2 size={18} color={colors['muted-foreground']} />
          ) : (
            <HardDrive size={18} color={colors['muted-foreground']} />
          )}
        </View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-md font-medium text-foreground">
            {codebase.alias}
            {location.primary !== codebase.alias ? (
              <Text className="font-normal text-muted-foreground"> · {location.primary}</Text>
            ) : null}
          </Text>
          {location.secondary ? (
            <Text numberOfLines={1} ellipsizeMode="middle" className="font-mono text-sm text-muted-foreground">
              {location.secondary}
            </Text>
          ) : null}
          {codebase.status === 'error' && codebase.lastError ? (
            <Text numberOfLines={2} className="text-sm text-danger">
              {codebase.lastError}
            </Text>
          ) : isCloningStatus(codebase.status) ? (
            <Text className="text-sm text-muted-foreground">Cloning on your computer…</Text>
          ) : meta ? (
            <Text className="text-sm text-muted-foreground">{meta}</Text>
          ) : null}
        </View>
        {isCloningStatus(codebase.status) ? (
          <Spinner />
        ) : isQuietCodebaseStatus(codebase.status) ? null : (
          <Badge label={codebase.status!} tone={codebaseStatusTone(codebase.status)} />
        )}
        <ChevronRight size={18} color={colors['muted-foreground']} />
      </View>
    </Touchable>
  );
}

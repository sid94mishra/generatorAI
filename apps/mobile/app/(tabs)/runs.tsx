// ────────────────────────────────────────────────────────────────
// Work — workflows, runs, automations and scripts.
//
// Four peer catalogues behind one segmented control rather than four tabs:
// HIG caps a tab bar at five destinations, and these are the same activity
// viewed at different levels (an automation triggers a workflow, which
// produces runs; a script is a workflow you can materialise).
//
// The last-used segment is remembered (`work.segment`) and a route param
// (`/runs?segment=workflows`) overrides it.
//
// Runs lead with an "Active" section (blocked, failed-awaiting or running —
// the only rows that cost anything to ignore), then date sections.
//
// No FAB: a run is started from a workflow's (or script's) own screen. The
// one creation path here — a new workflow from a template — is a small
// action on the Workflows segment, shown only when the device may create.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Bot, FileCode2, LayoutTemplate, Play, Workflow as WorkflowIcon } from 'lucide-react-native';
import {
  epochOr,
  queryKeys,
  type AutomationSummary,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useAdminApi } from '../../src/api/useAdminApi';
import { useFeature } from '../../src/components/runs/useFeature';
import { ScriptRow } from '../../src/components/work/ScriptRow';
import { parseScriptRows, type ScriptRowView } from '../../src/components/work/scriptModel';
import { TemplatePickerSheet } from '../../src/components/work/TemplatePickerSheet';
import { Button } from '../../src/components/ui/Button';
import { isActive, needsAttention } from '../../src/components/runs/statusStyle';
import { AutomationCard, RunCard, WorkflowCard } from '../../src/components/work/cards';
import { sectionRows } from '../../src/components/common/groupByDay';
import {
  WORK_SEGMENTS,
  WORK_SEGMENT_LABEL,
  WORK_SEGMENT_PREF_KEY,
  resolveWorkSegment,
  type WorkSegment,
} from '../../src/components/work/workSegment';
import { SegmentedControl, useSegmentSwipe } from '../../src/components/ui/SegmentedControl';
import { ListSectionHeader } from '../../src/components/ui/ListItem';
import { usePullToRefresh } from '../../src/components/ui/usePullToRefresh';
import { SearchField } from '../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { TabHeaderActions } from '../../src/navigation/TabHeaderActions';
import { useTabShell } from '../../src/navigation/tabShell';
import { useScrollToTop, scrollerToTop } from '../../src/navigation/scrollToTop';
import { prefs } from '../../src/storage/prefs';
import { useTheme } from '../../src/theme/ThemeProvider';

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'run'; item: WorkflowRunSummary }
  | { kind: 'workflow'; item: WorkflowSummary }
  | { kind: 'automation'; item: AutomationSummary }
  | { kind: 'script'; item: ScriptRowView };

/** Cache key for the scripts catalogue (no shared key in client-core). */
const SCRIPTS_QUERY_KEY = ['workflow-scripts'] as const;

export default function WorkScreen(): React.ReactElement {
  const api = useApi();
  const admin = useAdminApi();
  const workflowEdit = useFeature('workflowEdit');
  const [templates, setTemplates] = useState(false);
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ segment?: string; new?: string }>();
  const [segment, setSegmentState] = useState<WorkSegment>(() =>
    resolveWorkSegment(params.segment, prefs.getString(WORK_SEGMENT_PREF_KEY)),
  );
  const [query, setQuery] = useState('');
  const listRef = useRef<never>(null);
  const shell = useTabShell();

  useScrollToTop('runs', scrollerToTop(listRef));

  const setSegment = useCallback((next: WorkSegment) => {
    setSegmentState(next);
    prefs.setString(WORK_SEGMENT_PREF_KEY, next);
  }, []);

  // A route param arriving while the tab is already mounted (Home's quick
  // action) must still switch the segment; clearing it afterwards stops the
  // same param re-applying every time the tab regains focus.
  //
  // `?new=1` used to open a coming-soon sheet; it is still cleared so an old
  // link does not linger in the URL.
  useEffect(() => {
    if (!params.segment && params.new !== '1') return;
    if (params.segment) setSegment(resolveWorkSegment(params.segment, undefined));
    router.setParams({ segment: undefined, new: undefined });
  }, [params.segment, params.new, setSegment]);

  const runs = useQuery({
    queryKey: queryKeys.runs(),
    queryFn: () => api.runs.list(),
    // Only polls while something is moving; a settled list would otherwise
    // wake the radio every fifteen seconds for nothing.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r: WorkflowRunSummary) => isActive(r.status)) ? 10_000 : false,
  });

  const workflows = useQuery({
    queryKey: queryKeys.workflows(),
    queryFn: () => api.workflows.list(),
  });

  const automations = useQuery({
    queryKey: queryKeys.automations(),
    queryFn: () => api.automations.list(),
  });

  const scripts = useQuery({
    queryKey: SCRIPTS_QUERY_KEY,
    queryFn: async () => parseScriptRows(await admin.scripts.list()),
    staleTime: 60_000,
  });

  const orderedRuns = useMemo(
    () =>
      [...(runs.data ?? [])].sort((a, b) => {
        const aBlocked = needsAttention(a.status);
        const bBlocked = needsAttention(b.status);
        if (aBlocked !== bBlocked) return aBlocked ? -1 : 1;
        const aActive = isActive(a.status);
        const bActive = isActive(b.status);
        if (aActive !== bActive) return aActive ? -1 : 1;
        return epochOr(b.updatedAt) - epochOr(a.updatedAt);
      }),
    [runs.data],
  );

  const active =
    segment === 'runs'
      ? runs
      : segment === 'workflows'
        ? workflows
        : segment === 'automations'
          ? automations
          : scripts;

  const segments = useMemo(
    () =>
      WORK_SEGMENTS.map((value) => ({
        value,
        label: WORK_SEGMENT_LABEL[value],
        ...(value === 'runs'
          ? { count: orderedRuns.length }
          : value === 'workflows'
            ? { count: workflows.data?.length ?? 0 }
            : value === 'automations'
              ? { count: automations.data?.length ?? 0 }
              : { count: scripts.data?.length ?? 0 }),
      })),
    [orderedRuns.length, workflows.data?.length, automations.data?.length, scripts.data?.length],
  );

  const swipeSegment = useSegmentSwipe(segments, segment, setSegment);
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-24, 24])
        .failOffsetY([-16, 16])
        .onEnd((event) => {
          if (Math.abs(event.translationX) < 48) return;
          swipeSegment(event.translationX);
        })
        .runOnJS(true),
    [swipeSegment],
  );

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (name: string | null | undefined) => !q || (name ?? '').toLowerCase().includes(q);

    if (segment === 'runs') {
      const found = orderedRuns.filter((r) => matches(r.name));
      if (q) return found.map((item) => ({ kind: 'run', item }));
      return sectionRows(found, {
        keyOf: (r) => r.id,
        timeOf: (r) => epochOr(r.updatedAt),
        pinned: {
          label: 'Active',
          key: 'active',
          test: (r) => isActive(r.status) || (needsAttention(r.status) && r.status !== 'failed'),
        },
      }).map((row) =>
        row.type === 'header'
          ? { kind: 'header', key: row.key, label: row.label }
          : { kind: 'run', item: row.item },
      );
    }
    if (segment === 'workflows') {
      return (workflows.data ?? []).filter((w) => matches(w.name)).map((item) => ({ kind: 'workflow', item }));
    }
    if (segment === 'automations') {
      return (automations.data ?? []).filter((a) => matches(a.name)).map((item) => ({ kind: 'automation', item }));
    }
    return (scripts.data ?? [])
      .filter((s) => matches(s.name) || s.tags.some((t) => matches(t)))
      .map((item) => ({ kind: 'script', item }));
  }, [segment, query, orderedRuns, workflows.data, automations.data, scripts.data]);

  const refetchAll = useCallback(
    () => Promise.all([runs.refetch(), workflows.refetch(), automations.refetch(), scripts.refetch()]),
    [runs, workflows, automations, scripts],
  );
  const pull = usePullToRefresh(
    refetchAll,
    runs.isFetching || workflows.isFetching || automations.isFetching || scripts.isFetching,
  );

  const header = (
    // The gutter is on the header/rows, not on contentContainerStyle:
    // LegendList's containers are absolutely positioned and never see it.
    <View className="gap-3 px-4 pb-1">
      <SegmentedControl segments={segments} value={segment} onChange={setSegment} accessibilityLabel="Work catalogue" />
      {/* Nothing to search in an empty catalogue — keep the field while a
          query is typed so it can be cleared. */}
      {query || (active?.data?.length ?? 0) > 0 ? (
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${WORK_SEGMENT_LABEL[segment].toLowerCase()}`}
        />
      ) : null}
      {segment === 'workflows' && workflowEdit.available && (workflows.data?.length ?? 0) > 0 ? (
        <Button
          label="New from template"
          variant="ghost"
          size="sm"
          haptic="tap"
          icon={<LayoutTemplate size={16} color={colors.primary} />}
          onPress={() => setTemplates(true)}
        />
      ) : null}
    </View>
  );

  const empty =
    active?.isLoading ? (
      <SkeletonList rows={5} variant="flat" />
    ) : active?.isError ? (
      <ErrorState message="Could not load this list." onRetry={() => void active.refetch()} />
    ) : query ? (
      <EmptyState title="No matches" message="Nothing here matches that search." />
    ) : segment === 'runs' ? (
      <EmptyState
        title="No runs yet"
        message="Open a workflow to start one."
        icon={<Play size={22} color={colors['muted-foreground']} />}
        {...((workflows.data?.length ?? 0) > 0
          ? { action: { label: 'Browse workflows', onPress: () => setSegment('workflows') } }
          : {})}
      />
    ) : segment === 'workflows' ? (
      <EmptyState
        title="No workflows yet"
        message={
          workflowEdit.available
            ? 'Start one from a template, or build it on desktop or web.'
            : 'Workflows you build on desktop or web show up here.'
        }
        icon={<WorkflowIcon size={22} color={colors['muted-foreground']} />}
        {...(workflowEdit.available
          ? { action: { label: 'Start from template', onPress: () => setTemplates(true) } }
          : {})}
      />
    ) : segment === 'scripts' ? (
      <EmptyState
        title="No scripts yet"
        message="Workflow scripts on the machine running GeneratorAI show up here."
        icon={<FileCode2 size={22} color={colors['muted-foreground']} />}
      />
    ) : (
      <EmptyState
        title="No automations yet"
        message="Automations you set up on desktop or web show up here."
        icon={<Bot size={22} color={colors['muted-foreground']} />}
      />
    );

  return (
    <View className="flex-1 bg-background">
      <Screen title="Work" variant="compact" trailing={<TabHeaderActions />} scroll={false}>
        <GestureDetector gesture={swipe}>
          <View className="flex-1">
            <LegendList
              ref={listRef as never}
              data={rows}
              keyExtractor={(row: Row) => (row.kind === 'header' ? row.key : `${row.kind}:${row.item.id}`)}
              getItemType={(row: Row) => row.kind}
              estimatedItemSize={64}
              recycleItems
              contentContainerStyle={{ paddingBottom: shell?.listBottom(false) ?? 48 }}
              ListHeaderComponent={header}
              ListEmptyComponent={empty}
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              renderItem={({ item: row }: { item: Row }) =>
                row.kind === 'header' ? (
                  <ListSectionHeader label={row.label} />
                ) : row.kind === 'run' ? (
                  <RunCard run={row.item} />
                ) : row.kind === 'workflow' ? (
                  <WorkflowCard workflow={row.item} runs={runs.data ?? []} />
                ) : row.kind === 'automation' ? (
                  <AutomationCard automation={row.item} />
                ) : (
                  <ScriptRow script={row.item} />
                )
              }
            />
          </View>
        </GestureDetector>
      </Screen>
      <TemplatePickerSheet visible={templates} onClose={() => setTemplates(false)} />
    </View>
  );
}

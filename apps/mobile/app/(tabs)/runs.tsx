// ────────────────────────────────────────────────────────────────
// Work — workflows, runs, automations and scripts.
//
// Four peer catalogues behind one segmented control rather than four tabs:
// HIG caps a tab bar at five destinations, and these are the same activity
// viewed at different levels (an automation triggers a workflow, which
// produces runs; a script is a workflow you can materialise).
//
// The last-used segment is remembered (`work.segment`) and a route param
// (`/runs?segment=workflows`) overrides it — that is how Home's "New
// workflow" lands on the right catalogue. `?new=1` opens that segment's
// "New" sheet on arrival, the same convention the Chats tab uses.
//
// Runs are ordered by urgency, not recency — a blocked run is the only
// thing on this screen that costs anything to ignore.
//
// Honest placeholders: workflow and automation authoring land in Phase 5
// (plan §6.9). Their "New" opens a sheet that says so, rather than a form
// that cannot save. Scripts have no client-core endpoint yet, so that
// segment is an empty state with no controls.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Bot, Play, Plus, Workflow as WorkflowIcon } from 'lucide-react-native';
import {
  epochOr,
  queryKeys,
  type AutomationSummary,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { isActive, needsAttention } from '../../src/components/runs/statusStyle';
import { AutomationCard, RunCard, WorkflowCard } from '../../src/components/work/cards';
import { ComingSoonSheet } from '../../src/components/work/ComingSoonSheet';
import {
  WORK_SEGMENTS,
  WORK_SEGMENT_LABEL,
  WORK_SEGMENT_PREF_KEY,
  resolveWorkSegment,
  type WorkSegment,
} from '../../src/components/work/workSegment';
import { SegmentedControl, useSegmentSwipe } from '../../src/components/ui/SegmentedControl';
import { Fab } from '../../src/components/ui/Button';
import { SearchField } from '../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { SettingsButton } from '../../src/components/ui/SettingsButton';
import { haptics } from '../../src/components/ui/haptics';
import { useScrollToTop, scrollerToTop } from '../../src/navigation/scrollToTop';
import { prefs } from '../../src/storage/prefs';
import { useTheme } from '../../src/theme/ThemeProvider';

type Row =
  | { kind: 'run'; item: WorkflowRunSummary }
  | { kind: 'workflow'; item: WorkflowSummary }
  | { kind: 'automation'; item: AutomationSummary };

const NEW_SHEET_COPY: Record<WorkSegment, { title: string; message: string } | null> = {
  workflows: {
    title: 'New workflow',
    message:
      'Workflow authoring on the phone lands in the next phase as a stage-outline editor. Until then, create workflows on the desktop or web app — they appear here and can be inspected and run-tracked.',
  },
  automations: {
    title: 'New automation',
    message:
      'The automation stepper (trigger, workflows, input mode, retry) lands in the next phase. Until then, create automations on the desktop or web app — their runs and history show up here.',
  },
  runs: null,
};

export default function WorkScreen(): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ segment?: string; new?: string }>();
  const [segment, setSegmentState] = useState<WorkSegment>(() =>
    resolveWorkSegment(params.segment, prefs.getString(WORK_SEGMENT_PREF_KEY)),
  );
  const [query, setQuery] = useState('');
  const [newSheet, setNewSheet] = useState(false);
  const listRef = useRef<never>(null);

  useScrollToTop('runs', scrollerToTop(listRef));

  const setSegment = useCallback((next: WorkSegment) => {
    setSegmentState(next);
    prefs.setString(WORK_SEGMENT_PREF_KEY, next);
  }, []);

  // A route param arriving while the tab is already mounted (Home's quick
  // action) must still switch the segment; clearing it afterwards stops the
  // same param re-applying every time the tab regains focus.
  useEffect(() => {
    if (!params.segment && params.new !== '1') return;
    if (params.segment) setSegment(resolveWorkSegment(params.segment, undefined));
    if (params.new === '1') setNewSheet(true);
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
    segment === 'runs' ? runs : segment === 'workflows' ? workflows : segment === 'automations' ? automations : null;

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
              : {}),
      })),
    [orderedRuns.length, workflows.data?.length, automations.data?.length],
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
      return orderedRuns.filter((r) => matches(r.name)).map((item) => ({ kind: 'run', item }));
    }
    if (segment === 'workflows') {
      return (workflows.data ?? []).filter((w) => matches(w.name)).map((item) => ({ kind: 'workflow', item }));
    }
    if (segment === 'automations') {
      return (automations.data ?? []).filter((a) => matches(a.name)).map((item) => ({ kind: 'automation', item }));
    }
    return [];
  }, [segment, query, orderedRuns, workflows.data, automations.data]);

  const refreshAll = useCallback(() => {
    haptics.tap();
    void runs.refetch();
    void workflows.refetch();
    void automations.refetch();
  }, [runs, workflows, automations]);

  const header = (
    // The gutter is on the header/rows, not on contentContainerStyle:
    // LegendList's containers are absolutely positioned and never see it.
    <View className="gap-3 px-4 pb-3">
      <SegmentedControl segments={segments} value={segment} onChange={setSegment} accessibilityLabel="Work catalogue" />
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={`Search ${WORK_SEGMENT_LABEL[segment].toLowerCase()}`}
      />
    </View>
  );

  const empty =
    active?.isLoading ? (
      <View className="px-4">
        <SkeletonList rows={5} />
      </View>
    ) : active?.isError ? (
      <ErrorState message="Could not load this list." onRetry={() => void active.refetch()} />
    ) : query ? (
      <EmptyState title="No matches" message="Nothing here matches that search." />
    ) : segment === 'runs' ? (
      <EmptyState
        title="No runs yet"
        message="Runs appear when a workflow or automation executes. Tap New to pick a workflow."
        icon={<Play size={22} color={colors['muted-foreground']} />}
      />
    ) : segment === 'workflows' ? (
      <EmptyState
        title="No workflows"
        message="Workflows are authored on the desktop or web app for now — a node graph needs more room than a phone has."
        icon={<WorkflowIcon size={22} color={colors['muted-foreground']} />}
      />
    ) : (
      <EmptyState
        title="No automations"
        message="Automations are created on the desktop or web app for now. Their runs and history show up here."
        icon={<Bot size={22} color={colors['muted-foreground']} />}
      />
    );

  const newCopy = NEW_SHEET_COPY[segment];

  const onNew = useCallback(() => {
    if (segment === 'runs') {
      // The only way to start a run from this app is from a workflow: the
      // run dialog (variables, uploads, overrides) lands with Builder-lite.
      // Until then "New run" takes you to the workflows to pick one.
      setSegment('workflows');
      return;
    }
    if (newCopy) setNewSheet(true);
  }, [segment, newCopy, setSegment]);

  return (
    <View className="flex-1 bg-background">
      <Screen title="Work" trailing={<SettingsButton />} scroll={false}>
        <GestureDetector gesture={swipe}>
          <View className="flex-1">
            <LegendList
              ref={listRef as never}
              data={rows}
              keyExtractor={(row: Row) => `${row.kind}:${row.item.id}`}
              estimatedItemSize={108}
              recycleItems
              contentContainerStyle={{ paddingBottom: 160, gap: 10 }}
              ListHeaderComponent={header}
              ListEmptyComponent={empty}
              refreshing={runs.isFetching || workflows.isFetching || automations.isFetching}
              onRefresh={refreshAll}
              renderItem={({ item: row }: { item: Row }) => (
                <View className="px-4">
                  {row.kind === 'run' ? (
                    <RunCard run={row.item} />
                  ) : row.kind === 'workflow' ? (
                    <WorkflowCard workflow={row.item} runs={runs.data ?? []} />
                  ) : (
                    <AutomationCard automation={row.item} />
                  )}
                </View>
              )}
            />
          </View>
        </GestureDetector>
      </Screen>

      <Fab
        accessibilityLabel={
          segment === 'runs'
            ? 'New run — pick a workflow'
            : `New ${WORK_SEGMENT_LABEL[segment].slice(0, -1).toLowerCase()}`
        }
        icon={<Plus size={22} color={colors['primary-foreground']} />}
        label="New"
        onPress={onNew}
        offset={64}
      />

      {newCopy ? (
        <ComingSoonSheet
          visible={newSheet}
          onClose={() => setNewSheet(false)}
          title={newCopy.title}
          message={newCopy.message}
        />
      ) : null}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// Workflows · Scripts · Automations.
//
// One mounted scene that renders whichever catalogue the navigation drawer
// asked for (`/runs?segment=workflows`) — the mobile form of three desktop
// sidebar pages. It has no switcher of its own: the drawer is the way between
// them, as the sidebar is on desktop. The last catalogue is remembered
// (`work.segment`) so a cold start returns to it.
//
// There is no runs list here. As on desktop a run lives under its workflow:
// open a workflow to see its runs and start a new one. Runs that are moving or
// waiting on a person surface on Home.
//
// Creating: the header "+" on Workflows starts one from a template (a phone
// cannot host the DAG builder); shown only when the device may create.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Bot, FileCode2, Plus, Workflow as WorkflowIcon } from 'lucide-react-native';
import {
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
import { IconButton } from '../../src/components/ui/Button';
import { isActive } from '../../src/components/runs/statusStyle';
import { AutomationCard, WorkflowCard } from '../../src/components/work/cards';
import {
  WORK_SEGMENT_LABEL,
  WORK_SEGMENT_PREF_KEY,
  resolveWorkSegment,
  type WorkSegment,
} from '../../src/components/work/workSegment';
import { ListSectionHeader } from '../../src/components/ui/ListItem';
import { usePullToRefresh } from '../../src/components/ui/usePullToRefresh';
import { SearchField } from '../../src/components/ui/Form';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { TabHeaderActions } from '../../src/navigation/TabHeaderActions';
import { MenuButton } from '../../src/navigation/shell/MenuButton';
import { useShellStore } from '../../src/navigation/shell/shellStore';
import { useTabShell } from '../../src/navigation/tabShell';
import { useScrollToTop, scrollerToTop } from '../../src/navigation/scrollToTop';
import { prefs } from '../../src/storage/prefs';
import { useTheme } from '../../src/theme/ThemeProvider';

type Row =
  | { kind: 'header'; key: string; label: string }
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

  const reportSegment = useShellStore((st) => st.setWorkSegment);
  const setSegment = useCallback(
    (next: WorkSegment) => {
      setSegmentState(next);
      prefs.setString(WORK_SEGMENT_PREF_KEY, next);
      reportSegment(next);
    },
    [reportSegment],
  );
  // The drawer lights the row for the segment on show, including the one this
  // scene opened on from the stored preference.
  useEffect(() => {
    reportSegment(segment);
  }, [reportSegment, segment]);

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

  const active = segment === 'workflows' ? workflows : segment === 'automations' ? automations : scripts;

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (name: string | null | undefined) => !q || (name ?? '').toLowerCase().includes(q);

    if (segment === 'workflows') {
      return (workflows.data ?? []).filter((w) => matches(w.name)).map((item) => ({ kind: 'workflow', item }));
    }
    if (segment === 'automations') {
      return (automations.data ?? []).filter((a) => matches(a.name)).map((item) => ({ kind: 'automation', item }));
    }
    return (scripts.data ?? [])
      .filter((s) => matches(s.name) || s.tags.some((t) => matches(t)))
      .map((item) => ({ kind: 'script', item }));
  }, [segment, query, workflows.data, automations.data, scripts.data]);

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
      {/* Nothing to search in an empty catalogue — keep the field while a
          query is typed so it can be cleared. */}
      {query || (active?.data?.length ?? 0) > 0 ? (
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${WORK_SEGMENT_LABEL[segment].toLowerCase()}`}
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
      <Screen
        title={WORK_SEGMENT_LABEL[segment]}
        variant="compact"
        leading={<MenuButton />}
        trailing={
          <TabHeaderActions>
            {/* Desktop's "Create Workflow". A phone cannot host the DAG
                builder, so creating here means starting from a template;
                anything built on desktop or web shows up in this list. */}
            {segment === 'workflows' && workflowEdit.available ? (
              <IconButton
                testID="new-workflow"
                accessibilityLabel="New workflow"
                accessibilityHint="Creates a workflow from a template"
                icon={<Plus size={22} color={colors.foreground} />}
                onPress={() => setTemplates(true)}
              />
            ) : null}
          </TabHeaderActions>
        }
        scroll={false}
      >
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
      </Screen>
      <TemplatePickerSheet visible={templates} onClose={() => setTemplates(false)} />
    </View>
  );
}

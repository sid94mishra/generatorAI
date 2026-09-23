// ────────────────────────────────────────────────────────────────
// Home — the reason to open this app on a phone.
//
// Sections, in the order that matters when you have thirty seconds:
//
//   tiles       chats, workflows, automations, server health
//   feed        Today · Running · Needs you (with counts), urgency-ranked
//   server      only when degraded
//
// Decisions are NOT repeated here as a card queue: the header bell opens the
// approvals sheet, and "Needs you" lists the same items as rows. New chat is
// the compose icon in the header, not a floating button over the feed.
//
// Everything is ONE virtualised list with the sections in its header and
// footer, so pull-to-refresh and scroll-to-top have one scroller.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { router } from 'expo-router';
import { SquarePen } from 'lucide-react-native';

import {
  useActivity,
  filterOperations,
  groupApprovals,
  type ActivityFilter,
  type Operation,
} from '../../src/api/useActivity';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { HealthCard } from '../../src/components/home/HealthCard';
import { StatTiles } from '../../src/components/home/StatTiles';
import { OperationCard } from '../../src/components/home/OperationCard';
import { SectionHeader } from '../../src/components/ui/primitives';
import { SegmentedControl, useSegmentSwipe } from '../../src/components/ui/SegmentedControl';
import { DRAWER_EDGE_HIT_SLOP } from '../../src/components/ui/SidePanel';
import { IconButton } from '../../src/components/ui/Button';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { usePullToRefresh } from '../../src/components/ui/usePullToRefresh';
import { TabHeaderActions } from '../../src/navigation/TabHeaderActions';
import { MenuButton } from '../../src/navigation/shell/MenuButton';
import { useTabShell } from '../../src/navigation/tabShell';
import { useScrollToTop, scrollerToTop } from '../../src/navigation/scrollToTop';
import { useTheme } from '../../src/theme/ThemeProvider';

const FILTERS = [
  { value: 'today' as const, label: 'Today' },
  { value: 'running' as const, label: 'Running' },
  { value: 'attention' as const, label: 'Needs you' },
];

const EMPTY_TITLE: Record<ActivityFilter, string> = {
  attention: 'Nothing is waiting on you',
  running: 'Nothing is running',
  today: 'Nothing in the last day',
};

export default function HomeScreen(): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const shell = useTabShell();
  const [filter, setFilter] = useState<ActivityFilter>('today');
  const activity = useActivity();
  const autoSwitched = useRef(false);
  const listRef = useRef<never>(null);

  useScrollToTop('index', scrollerToTop(listRef));

  /**
   * Open on the urgent filter when there is anything blocked.
   *
   * Fires at most once and never after the user has touched the control, so
   * it can never fight a deliberate choice.
   */
  useEffect(() => {
    if (autoSwitched.current || activity.isLoading) return;
    autoSwitched.current = true;
    if (activity.counts.attention > 0) setFilter('attention');
  }, [activity.isLoading, activity.counts.attention]);

  const approvals = useMemo(() => groupApprovals(activity.operations), [activity.operations]);

  const visible = useMemo(() => filterOperations(activity.operations, filter), [activity.operations, filter]);

  const segments = useMemo(
    () =>
      FILTERS.map((f) =>
        f.value === 'running'
          ? { ...f, count: activity.counts.running }
          : f.value === 'attention'
            ? { ...f, count: approvals.total }
            : f,
      ),
    [activity.counts.running, approvals.total],
  );

  const swipeFilter = useSegmentSwipe(segments, filter, setFilter);
  // Horizontal-only, and it fails to the list's vertical scroll rather than
  // competing with it.
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-24, 24])
        .failOffsetY([-16, 16])
        // The left edge strip opens the navigation drawer.
        .hitSlop(DRAWER_EDGE_HIT_SLOP)
        .onEnd((event) => {
          if (Math.abs(event.translationX) < 48) return;
          swipeFilter(event.translationX);
        })
        .runOnJS(true),
    [swipeFilter],
  );
  // The dashboard's Workflows count. Same key as the Workflows list, so
  // opening that list afterwards is already warm.
  const workflows = useQuery({
    queryKey: queryKeys.workflows(),
    queryFn: () => api.workflows.list(),
    staleTime: 60_000,
  });

  const pull = usePullToRefresh(activity.refetch, activity.isFetching);

  const header = (
    // `paddingHorizontal` in a LegendList's contentContainerStyle does not
    // reach the rows (containers are absolutely positioned), so each block
    // carries its own 16pt gutter; flat rows bring their own.
    <View className="gap-3 pb-2">
      <StatTiles
        chats={activity.isLoading ? null : activity.counts.chats}
        workflows={workflows.data ? workflows.data.length : null}
        automations={activity.isLoading ? null : activity.counts.automations}
        health={activity.health?.status ?? null}
      />
      <View className="px-4 pt-1">
        <SegmentedControl segments={segments} value={filter} onChange={setFilter} accessibilityLabel="Activity filter" />
      </View>
    </View>
  );

  const unhealthy = Boolean(activity.health) && activity.health?.status !== 'ok';

  const footer = unhealthy ? (
    // A healthy server is not news; the card appears only when degraded.
    <View className="px-4 pt-2">
      <SectionHeader title="Server" />
      <HealthCard health={activity.health} />
    </View>
  ) : null;

  // An empty filter with work sitting in another one: offer the filter that
  // has something instead of telling the user to go and find it.
  const fallbackFilter = FILTERS.find(
    (f) => f.value !== filter && filterOperations(activity.operations, f.value).length > 0,
  );

  const empty = activity.isLoading ? (
    <SkeletonList rows={5} variant="flat" />
  ) : activity.isError ? (
    <ErrorState message="Could not reach the server." onRetry={activity.refetch} />
  ) : (
    <EmptyState
      title={EMPTY_TITLE[filter]}
      {...(activity.operations.length === 0
        ? {
            message: 'Start a chat and it shows up here as it works.',
            action: { label: 'New chat', onPress: () => router.push('/chats?new=1') },
          }
        : fallbackFilter
          ? { action: { label: `Show ${fallbackFilter.label}`, onPress: () => setFilter(fallbackFilter.value) } }
          : {})}
    />
  );

  return (
    <View className="flex-1 bg-background">
      <Screen
        title="Home"
        variant="compact"
        leading={<MenuButton />}
        trailing={
          <TabHeaderActions>
            <IconButton
              accessibilityLabel="New chat"
              testID="home-new-chat"
              icon={<SquarePen size={20} color={colors.foreground} />}
              onPress={() => router.push('/chats?new=1')}
            />
          </TabHeaderActions>
        }
        scroll={false}
      >
        <GestureDetector gesture={swipe}>
          <View className="flex-1">
            <LegendList
              ref={listRef as never}
              data={visible}
              keyExtractor={(op: Operation) => op.id}
              estimatedItemSize={64}
              recycleItems
              contentContainerStyle={{ paddingBottom: shell?.listBottom(false) ?? 32 }}
              ListHeaderComponent={header}
              ListEmptyComponent={empty}
              ListFooterComponent={footer}
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              renderItem={({ item }: { item: Operation }) => <OperationCard operation={item} />}
            />
          </View>
        </GestureDetector>
      </Screen>

    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// Home — the reason to open this app on a phone.
//
// Sections, in the order that matters when you have thirty seconds:
//
//   approvals   every chat or run waiting on a decision, as cards you can
//               act on — first, always, whenever there is one
//   stat rail   Needs you · Running · Chats · Runs · health
//   feed        Today · Running · Needs you, urgency-ranked, swipeable
//   health      the server's own status
//   quick       New chat · New workflow · Pair a device
//
// The web dashboard puts the same three feed tabs above a table. A table
// does not survive a 393pt viewport, so rows become cards with the status
// carried by icon + label.
//
// Everything is ONE virtualised list with the sections in its header and
// footer, so pull-to-refresh, scroll-to-top and the collapsing title all
// have exactly one scroller to talk to.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { router } from 'expo-router';
import { Activity as ActivityIcon, BellRing, MessagesSquare, Plus, ServerCog, Workflow } from 'lucide-react-native';

import {
  useActivity,
  filterOperations,
  groupApprovals,
  type ActivityFilter,
  type Operation,
} from '../../src/api/useActivity';
import { ApprovalsQueue } from '../../src/components/home/ApprovalsQueue';
import { HealthCard } from '../../src/components/home/HealthCard';
import { OperationCard } from '../../src/components/home/OperationCard';
import { QuickActions } from '../../src/components/home/QuickActions';
import { StatRail, type StatItem } from '../../src/components/home/StatRail';
import { SectionHeader } from '../../src/components/ui/primitives';
import { SegmentedControl, useSegmentSwipe } from '../../src/components/ui/SegmentedControl';
import { Fab } from '../../src/components/ui/Button';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { SettingsButton } from '../../src/components/ui/SettingsButton';
import { haptics } from '../../src/components/ui/haptics';
import { useScrollToTop, scrollerToTop } from '../../src/navigation/scrollToTop';
import { useTheme } from '../../src/theme/ThemeProvider';

const FILTERS = [
  { value: 'today' as const, label: 'Today' },
  { value: 'running' as const, label: 'Running' },
  { value: 'attention' as const, label: 'Needs you' },
];

export default function HomeScreen(): React.ReactElement {
  const { colors } = useTheme();
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
  const blocked = useMemo(() => [...approvals.chats, ...approvals.runs], [approvals]);

  const visible = useMemo(
    () => filterOperations(activity.operations, filter),
    [activity.operations, filter],
  );

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

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
        .onEnd((event) => {
          if (Math.abs(event.translationX) < 48) return;
          swipeFilter(event.translationX);
        })
        .runOnJS(true),
    [swipeFilter],
  );

  const refresh = useCallback(() => {
    haptics.tap();
    activity.refetch();
  }, [activity]);

  const stats = useMemo<StatItem[]>(
    () => [
      {
        id: 'attention',
        label: 'Needs you',
        value: approvals.total,
        icon: <BellRing size={16} color={colors.warning} />,
        tone: approvals.total > 0 ? 'warning' : 'neutral',
        onPress: () => setFilter('attention'),
      },
      {
        id: 'running',
        label: 'Running',
        value: activity.counts.running,
        icon: <ActivityIcon size={16} color={colors.info} />,
        tone: activity.counts.running > 0 ? 'info' : 'neutral',
        onPress: () => setFilter('running'),
      },
      {
        id: 'chats',
        label: 'Chats',
        value: activity.counts.chats,
        icon: <MessagesSquare size={16} color={colors['muted-foreground']} />,
        onPress: () => router.push('/chats'),
      },
      {
        id: 'runs',
        label: 'Runs',
        value: activity.counts.runs,
        icon: <Workflow size={16} color={colors['muted-foreground']} />,
        onPress: () => router.push('/runs?segment=runs' as never),
      },
      {
        id: 'health',
        label: activity.health?.status === 'ok' ? 'Healthy' : 'Degraded',
        value: activity.health?.harness.type ?? '—',
        icon: (
          <ServerCog
            size={16}
            color={activity.health?.status === 'ok' ? colors.success : colors.warning}
          />
        ),
        tone: activity.health?.status === 'ok' ? 'success' : 'warning',
      },
    ],
    [approvals.total, activity.counts, activity.health, colors],
  );

  const header = (
    <View className="gap-3 pb-3">
      {/* (a) Approvals queue — first whenever non-empty. */}
      <ApprovalsQueue blocked={blocked} />

      {/* (b) Stat rail. */}
      <StatRail items={stats} loading={activity.isLoading} />

      {/* (c) Feed filter. */}
      <SegmentedControl segments={segments} value={filter} onChange={setFilter} />
    </View>
  );

  const footer = (
    <View className="gap-3 pt-2">
      {/* (d) Health. */}
      <SectionHeader title="Server" />
      <HealthCard health={activity.health} />

      {/* (e) Quick actions. */}
      <SectionHeader title="Quick actions" />
      <QuickActions />
    </View>
  );

  const empty = activity.isLoading ? (
    <SkeletonList rows={5} />
  ) : activity.isError ? (
    <ErrorState message="Could not reach the server." onRetry={activity.refetch} />
  ) : (
    <EmptyState
      title={
        filter === 'attention'
          ? 'Nothing is waiting on you'
          : filter === 'running'
            ? 'Nothing is running'
            : 'Nothing in the last day'
      }
      message={
        // An empty view with work sitting in another filter is the one case
        // where "nothing here" is actively misleading.
        activity.operations.length > 0
          ? `There are ${activity.operations.length} older items — swipe to another filter.`
          : filter === 'attention'
            ? 'Blocked runs and pending approvals will appear here.'
            : 'Start a chat and it shows up here as it works.'
      }
      {...(activity.operations.length === 0
        ? { action: { label: 'New chat', onPress: () => router.push('/chats?new=1') } }
        : {})}
    />
  );

  return (
    <View className="flex-1 bg-background">
      <Screen title="Home" subtitle={greeting} trailing={<SettingsButton />} scroll={false}>
        <GestureDetector gesture={swipe}>
          <View className="flex-1">
            <LegendList
              ref={listRef as never}
              data={visible}
              keyExtractor={(op: Operation) => op.id}
              estimatedItemSize={66}
              recycleItems
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 160, gap: 10 }}
              ListHeaderComponent={header}
              ListEmptyComponent={empty}
              ListFooterComponent={footer}
              refreshing={activity.isFetching && !activity.isLoading}
              onRefresh={refresh}
              renderItem={({ item, index }: { item: Operation; index: number }) => (
                <OperationCard operation={item} index={index} />
              )}
            />
          </View>
        </GestureDetector>
      </Screen>

      <Fab
        accessibilityLabel="New chat"
        icon={<Plus size={22} color={colors['primary-foreground']} />}
        label="New chat"
        onPress={() => router.push('/chats?new=1')}
        offset={64}
      />
    </View>
  );
}

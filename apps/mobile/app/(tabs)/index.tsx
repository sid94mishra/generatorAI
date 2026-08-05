// ────────────────────────────────────────────────────────────────
// Activity — the reason to open this app on a phone.
//
// Mission control, ordered by urgency rather than by recency:
//
//   stat rail   four glanceable numbers, horizontally scrollable
//   filter      Today · Running · Needs you
//   feed        merged chats + runs + automations, urgency-ranked
//
// The web dashboard puts the same three tabs above a table. A table does not
// survive a 393pt viewport, so the rows become cards with the status colour
// carried on a leading rail — readable in a glance without reading any text.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import {
  Activity as ActivityIcon,
  BellRing,
  Bot,
  MessagesSquare,
  Plus,
  ServerCog,
  Workflow,
} from 'lucide-react-native';

import {
  useActivity,
  filterOperations,
  type ActivityFilter,
  type Operation,
} from '../../src/api/useActivity';
import { relativeTime } from '../../src/components/runs/formatTime';
import { statusLabel } from '../../src/components/runs/statusStyle';
import { Card, StatusDot, type Tone } from '../../src/components/ui/primitives';
import { SegmentedControl, useSegmentSwipe } from '../../src/components/ui/SegmentedControl';
import { Touchable } from '../../src/components/ui/Touchable';
import { Fab } from '../../src/components/ui/Button';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { Skeleton, SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { SettingsButton } from '../../src/components/ui/SettingsButton';
import { MAX_SCALE, useFontScale, useReduceMotion } from '../../src/components/ui/accessibility';
import { stagger } from '../../src/components/ui/motion';
import { useScrollToTop, scrollerToTop } from '../../src/navigation/scrollToTop';
import { useTheme } from '../../src/theme/ThemeProvider';

const KIND_ICON = {
  chat: MessagesSquare,
  run: Workflow,
  automation: Bot,
} as const;

const FILTERS = [
  { value: 'today' as const, label: 'Today' },
  { value: 'running' as const, label: 'Running' },
  { value: 'attention' as const, label: 'Needs you' },
];

function toneFor(op: Operation): Tone {
  // Failure is checked BEFORE `blocked`: a failed run satisfies both, and
  // amber for a failure is a genuine misreport.
  if (op.status === 'failed') return 'danger';
  if (op.blocked) return 'warning';
  if (op.running) return 'info';
  if (op.status === 'completed') return 'success';
  return 'neutral';
}

export default function ActivityScreen(): React.ReactElement {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<ActivityFilter>('today');
  const activity = useActivity();
  const autoSwitched = useRef(false);
  const listRef = useRef<never>(null);

  useScrollToTop('index', scrollerToTop(listRef));

  /**
   * Open on the urgent filter when there is anything blocked.
   *
   * "Today" is the right default for a healthy install, but landing on an
   * empty Today while 137 items sit blocked reads as a broken app. This fires
   * at most once and never after the user has touched the control, so it can
   * never fight a deliberate choice.
   */
  useEffect(() => {
    if (autoSwitched.current || activity.isLoading) return;
    autoSwitched.current = true;
    if (activity.counts.attention > 0) setFilter('attention');
  }, [activity.isLoading, activity.counts.attention]);

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
            ? { ...f, count: activity.counts.attention }
            : f,
      ),
    [activity.counts.running, activity.counts.attention],
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

  const header = (
    <View className="gap-3 pb-3">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingRight: 8 }}
      >
        {activity.isLoading ? (
          <>
            <Skeleton width={132} height={86} radius={16} />
            <Skeleton width={132} height={86} radius={16} />
            <Skeleton width={132} height={86} radius={16} />
          </>
        ) : (
          <>
            <Stat
              label="Needs you"
              value={activity.counts.attention}
              icon={<BellRing size={16} color={colors.warning} />}
              tone={activity.counts.attention > 0 ? 'warning' : 'neutral'}
              onPress={() => setFilter('attention')}
            />
            <Stat
              label="Running"
              value={activity.counts.running}
              icon={<ActivityIcon size={16} color={colors.info} />}
              tone={activity.counts.running > 0 ? 'info' : 'neutral'}
              onPress={() => setFilter('running')}
            />
            <Stat
              label="Chats"
              value={activity.counts.chats}
              icon={<MessagesSquare size={16} color={colors['muted-foreground']} />}
              onPress={() => router.push('/chats')}
            />
            <Stat
              label="Runs"
              value={activity.counts.runs}
              icon={<Workflow size={16} color={colors['muted-foreground']} />}
              onPress={() => router.push('/runs')}
            />
            <Stat
              label={activity.health?.status === 'ok' ? 'Healthy' : 'Degraded'}
              value={activity.health?.harness.type ?? '—'}
              icon={
                <ServerCog
                  size={16}
                  color={activity.health?.status === 'ok' ? colors.success : colors.warning}
                />
              }
              tone={activity.health?.status === 'ok' ? 'success' : 'warning'}
            />
          </>
        )}
      </ScrollView>

      <SegmentedControl segments={segments} value={filter} onChange={setFilter} />
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
      <Screen title="Activity" subtitle={greeting} trailing={<SettingsButton />} scroll={false}>
        <GestureDetector gesture={swipe}>
          <View className="flex-1">
            <LegendList
              ref={listRef as never}
              data={visible}
              keyExtractor={(op: Operation) => op.id}
              estimatedItemSize={66}
              recycleItems
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140, gap: 10 }}
              ListHeaderComponent={header}
              ListEmptyComponent={empty}
              refreshing={activity.isFetching && !activity.isLoading}
              onRefresh={activity.refetch}
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

function Stat({
  label,
  value,
  icon,
  tone = 'neutral',
  onPress,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: Tone;
  onPress?: () => void;
}): React.ReactElement {
  const fontScale = useFontScale();
  // The tile grows with the reading size rather than clipping its own number,
  // which the previous fixed 86×132 did at anything above the default.
  const height = Math.round(86 * Math.min(Math.max(fontScale, 1), 1.6));
  const width = Math.round(132 * Math.min(Math.max(fontScale, 1), 1.35));

  const body = (
    <Card
      className={`justify-between p-3 ${tone !== 'neutral' ? 'border-primary' : ''}`}
      style={{ height, width }}
    >
      <View className="flex-row items-center justify-between">
        {icon}
        <StatusDot tone={tone} label={null} />
      </View>
      <View>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCALE.control}
          className="text-2xl font-bold text-foreground"
        >
          {value}
        </Text>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCALE.chrome}
          className="text-xs text-muted-foreground"
        >
          {label}
        </Text>
      </View>
    </Card>
  );

  // A tile with nowhere to go is not a button, and announcing it as a
  // disabled one is worse than announcing it as the text it is.
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={`${label}: ${value}`}>
        {body}
      </View>
    );
  }

  return (
    <Touchable
      accessibilityLabel={`${label}: ${value}`}
      haptic="tap"
      scale="large"
      onPress={onPress}
    >
      {body}
    </Touchable>
  );
}

function OperationCard({
  operation,
  index,
}: {
  operation: Operation;
  index: number;
}): React.ReactElement {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const Icon = KIND_ICON[operation.kind];
  const tone = toneFor(operation);
  const status = statusLabel(operation.status);

  const open = useCallback(() => {
    router.push(operation.href as never);
  }, [operation.href]);

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.delay(stagger(index)).duration(180)}
    >
      <Touchable
        accessibilityLabel={`${operation.name}, ${status}`}
        accessibilityHint={`Updated ${relativeTime(operation.updatedAt)}`}
        haptic="tap"
        scale="large"
        onPress={open}
      >
        <Card className="flex-row items-center gap-3 p-3.5">
          <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
            <Icon size={16} color={colors['muted-foreground']} />
          </View>

          <View className="flex-1 gap-0.5">
            <Text numberOfLines={2} className="text-md font-medium text-foreground">
              {operation.name}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <StatusDot tone={tone} label={null} />
              <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
                {status} · {relativeTime(operation.updatedAt)}
              </Text>
            </View>
          </View>
        </Card>
      </Touchable>
    </Animated.View>
  );
}

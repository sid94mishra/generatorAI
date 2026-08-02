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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
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
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Touchable } from '../../src/components/ui/Touchable';
import { Fab } from '../../src/components/ui/Button';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { Skeleton, SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { SettingsButton } from '../../src/components/ui/SettingsButton';
import { useTheme } from '../../src/theme/ThemeProvider';

const KIND_ICON = {
  chat: MessagesSquare,
  run: Workflow,
  automation: Bot,
} as const;

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

  return (
    <View className="flex-1 bg-background">
      <Screen
        title="Activity"
        subtitle={greeting}
        trailing={<SettingsButton />}
        onRefresh={activity.refetch}
        refreshing={activity.isFetching && !activity.isLoading}
      >
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

        <SegmentedControl
          segments={[
            { value: 'today', label: 'Today' },
            { value: 'running', label: 'Running', count: activity.counts.running },
            { value: 'attention', label: 'Needs you', count: activity.counts.attention },
          ]}
          value={filter}
          onChange={setFilter}
        />

        {activity.isLoading ? (
          <SkeletonList rows={5} />
        ) : activity.isError ? (
          <ErrorState
            message="Could not reach the server."
            onRetry={activity.refetch}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              filter === 'attention'
                ? 'Nothing is waiting on you'
                : filter === 'running'
                  ? 'Nothing is running'
                  : 'Nothing in the last day'
            }
            message={
              // An empty view with work sitting in another filter is the one
              // case where "nothing here" is actively misleading.
              activity.operations.length > 0
                ? `There are ${activity.operations.length} older items — check the other filters.`
                : filter === 'attention'
                  ? 'Blocked runs and pending approvals will appear here.'
                  : 'Start a chat and it shows up here as it works.'
            }
            {...(activity.operations.length === 0
              ? { action: { label: 'New chat', onPress: () => router.push('/chats?new=1') } }
              : {})}
          />
        ) : (
          <View className="gap-2.5">
            {visible.map((op, index) => (
              <OperationCard key={op.id} operation={op} index={index} />
            ))}
          </View>
        )}
      </Screen>

      <Fab
        accessibilityLabel="New chat"
        icon={<Plus size={22} color={colors['primary-foreground']} />}
        label="New chat"
        onPress={() => router.push('/chats?new=1')}
        bottom={24}
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
  return (
    <Touchable
      accessibilityLabel={`${label}: ${value}`}
      disabled={!onPress}
      haptic="tap"
      scale="large"
      onPress={onPress ?? (() => {})}
    >
      <Card
        className={`h-[86px] w-[132px] justify-between p-3 ${tone !== 'neutral' ? 'border-primary' : ''}`}
      >
        <View className="flex-row items-center justify-between">
          {icon}
          <StatusDot tone={tone} />
        </View>
        <View>
          <Text numberOfLines={1} className="text-2xl font-bold text-foreground">
            {value}
          </Text>
          <Text numberOfLines={1} className="text-xs text-muted-foreground">
            {label}
          </Text>
        </View>
      </Card>
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
  const Icon = KIND_ICON[operation.kind];
  const tone = toneFor(operation);

  return (
    <Animated.View entering={FadeIn.delay(Math.min(index, 8) * 25).duration(180)}>
      <Touchable
        accessibilityLabel={`${operation.name}, ${statusLabel(operation.status)}`}
        haptic="tap"
        scale="large"
        onPress={() => router.push(operation.href as never)}
      >
        <Card className="flex-row items-center gap-3 p-3.5">
          <View className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle">
            <Icon size={16} color={colors['muted-foreground']} />
          </View>

          <View className="flex-1 gap-0.5">
            <Text numberOfLines={1} className="text-md font-medium text-foreground">
              {operation.name}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <StatusDot tone={tone} />
              <Text className="text-xs text-muted-foreground">
                {statusLabel(operation.status)} · {relativeTime(operation.updatedAt)}
              </Text>
            </View>
          </View>
        </Card>
      </Touchable>
    </Animated.View>
  );
}

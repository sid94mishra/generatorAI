// ────────────────────────────────────────────────────────────────
// OperationCard — one row of the Home feed.
//
// Chats, runs and automations share a card so the feed reads as one list.
// Status is carried by an icon + label pair, never colour alone.
// ────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Bot, MessagesSquare, Workflow } from 'lucide-react-native';

import type { Operation } from '../../api/activityRanking';
import { relativeTime } from '../runs/formatTime';
import { statusLabel } from '../runs/statusStyle';
import { Card, StatusDot, type Tone } from '../ui/primitives';
import { Touchable } from '../ui/Touchable';
import { useReduceMotion } from '../ui/accessibility';
import { stagger } from '../ui/motion';
import { useTheme } from '../../theme/ThemeProvider';

const KIND_ICON = {
  chat: MessagesSquare,
  run: Workflow,
  automation: Bot,
} as const;

export function toneFor(op: Operation): Tone {
  // Failure is checked BEFORE `blocked`: a failed run satisfies both, and
  // amber for a failure is a genuine misreport.
  if (op.status === 'failed') return 'danger';
  if (op.blocked) return 'warning';
  if (op.running) return 'info';
  if (op.status === 'completed') return 'success';
  return 'neutral';
}

export function OperationCard({
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
    <Animated.View entering={reduceMotion ? undefined : FadeIn.delay(stagger(index)).duration(180)}>
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

// ────────────────────────────────────────────────────────────────
// ApprovalsQueue — the first section of Home whenever it is non-empty.
//
// Codex/Cursor pattern: approvals are a first-class list, not something
// buried in a transcript. The queue shows up to three cards and a "Review
// all" link into the `/approvals` sheet; a longer queue on the Home screen
// would push the feed below the fold for exactly the users who have the
// most to look at.
//
// Optimistic removal: a card whose gate was just answered disappears at
// once and the activity poll confirms it. Putting it back on failure is the
// toast's job (`useGateDecision`).
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';

import type { Operation } from '../../api/activityRanking';
import { APPROVALS_ROUTE, gateRoute, planRoute } from '../../navigation/routes';
import { DecisionCard } from './DecisionCard';
import { useGateDecision } from './useGateDecision';
import { SectionHeader } from '../ui/primitives';
import { Touchable } from '../ui/Touchable';
import { useTheme } from '../../theme/ThemeProvider';

const HOME_LIMIT = 3;

/** Where a decision card goes when tapped: the gate sheet if there is one, else the chat/run. */
export function decisionHref(op: Operation): string {
  if (op.kind === 'chat' && op.gate) {
    const chatId = op.id.startsWith('chat:') ? op.id.slice('chat:'.length) : op.id;
    if (op.gate.kind === 'plan_review' && op.gate.planId) return planRoute(chatId, op.gate.planId);
    return gateRoute(chatId, op.gate.interactionId);
  }
  return op.href;
}

export function chatIdOf(op: Operation): string | null {
  return op.kind === 'chat' && op.id.startsWith('chat:') ? op.id.slice('chat:'.length) : null;
}

export function ApprovalsQueue({
  blocked,
  limit = HOME_LIMIT,
}: {
  blocked: Operation[];
  limit?: number;
}): React.ReactElement | null {
  const { colors } = useTheme();
  const decide = useGateDecision();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const visible = blocked.filter((op) => !dismissed.has(op.id));
  const shown = visible.slice(0, limit);
  const rest = visible.length - shown.length;

  const onPermission = useCallback(
    async (op: Operation, behavior: 'allow' | 'deny') => {
      const chatId = chatIdOf(op);
      if (!chatId || !op.gate) return;
      await decide.permission(chatId, op.gate.interactionId, behavior);
      setDismissed((prev) => new Set(prev).add(op.id));
    },
    [decide],
  );

  if (visible.length === 0) return null;

  return (
    <View className="gap-2.5">
      <SectionHeader
        title="Waiting for you"
        className="pt-1"
        action={
          <Touchable
            accessibilityLabel={`Review all, ${visible.length} waiting`}
            haptic="tap"
            ripple={false}
            onPress={() => router.push(APPROVALS_ROUTE)}
            className="min-h-11 flex-row items-center gap-0.5 px-1"
          >
            <Text className="text-sm font-medium text-primary">Review all</Text>
            <ChevronRight size={16} color={colors.primary} />
          </Touchable>
        }
      />
      {shown.map((op) => (
        <DecisionCard
          key={op.id}
          operation={op}
          onOpen={() => router.push(decisionHref(op) as never)}
          {...(op.gate?.kind === 'tool_permission'
            ? { onPermission: (behavior: 'allow' | 'deny') => onPermission(op, behavior) }
            : {})}
        />
      ))}
      {rest > 0 ? (
        <Touchable
          accessibilityLabel={`${rest} more waiting, review all`}
          haptic="tap"
          onPress={() => router.push(APPROVALS_ROUTE)}
          className="min-h-11 items-center justify-center rounded-xl bg-control px-3"
        >
          <Text className="text-sm font-medium text-foreground">
            {rest} more waiting — review all
          </Text>
        </Touchable>
      ) : null}
    </View>
  );
}

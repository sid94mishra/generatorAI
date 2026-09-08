// ────────────────────────────────────────────────────────────────
// /approvals — everything waiting on a person, in one sheet.
//
// Grouped Chats / Runs. Each card carries the quick action its gate allows:
// a tool permission is answered right here (Allow / Deny); a question or a
// plan opens its own sheet; a run opens the run. Cards leave the list the
// moment their decision is accepted (optimistic) and the activity poll
// confirms. Push notifications for "N things waiting" land here.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';

import { useActivity, groupApprovals, type Operation } from '../src/api/useActivity';
import { ApprovalsQueueEmptyHint } from '../src/components/home/ApprovalsEmpty';
import { DecisionCard } from '../src/components/home/DecisionCard';
import { chatIdOf, decisionHref } from '../src/components/home/ApprovalsQueue';
import { useGateDecision } from '../src/components/home/useGateDecision';
import { RouteSheet } from '../src/navigation/RouteSheet';
import { SectionHeader } from '../src/components/ui/primitives';
import { EmptyState, ErrorState } from '../src/components/ui/States';
import { SkeletonList } from '../src/components/ui/Skeleton';
import { haptics } from '../src/components/ui/haptics';
import { useTheme } from '../src/theme/ThemeProvider';

export default function ApprovalsScreen(): React.ReactElement {
  const { colors } = useTheme();
  const activity = useActivity();
  const decide = useGateDecision();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const groups = useMemo(() => {
    const all = groupApprovals(activity.operations);
    return {
      chats: all.chats.filter((op) => !dismissed.has(op.id)),
      runs: all.runs.filter((op) => !dismissed.has(op.id)),
    };
  }, [activity.operations, dismissed]);
  const total = groups.chats.length + groups.runs.length;

  const onPermission = useCallback(
    async (op: Operation, behavior: 'allow' | 'deny') => {
      const chatId = chatIdOf(op);
      if (!chatId || !op.gate) return;
      await decide.permission(chatId, op.gate.interactionId, behavior);
      setDismissed((prev) => new Set(prev).add(op.id));
    },
    [decide],
  );

  const open = useCallback((op: Operation) => {
    router.push(decisionHref(op) as never);
  }, []);

  const subtitle =
    total === 0 ? undefined : total === 1 ? '1 decision waiting' : `${total} decisions waiting`;

  return (
    <RouteSheet
      title="Approvals"
      {...(subtitle ? { subtitle } : {})}
      onRefresh={() => {
        haptics.tap();
        activity.refetch();
      }}
      refreshing={activity.isFetching && !activity.isLoading}
    >
      {activity.isLoading ? (
        <SkeletonList rows={4} />
      ) : activity.isError ? (
        <ErrorState message="Could not reach the server." onRetry={activity.refetch} />
      ) : total === 0 ? (
        <>
          <EmptyState
            title="Nothing is waiting on you"
            message="Tool permissions, questions, plan reviews and blocked runs appear here the moment an agent needs you."
            icon={<CheckCircle2 size={24} color={colors.success} />}
          />
          <View className="-mt-8">
            <ApprovalsQueueEmptyHint />
          </View>
        </>
      ) : (
        <View className="gap-2.5">
          {groups.chats.length > 0 ? (
            <>
              <SectionHeader title={`Chats (${groups.chats.length})`} className="pt-0" />
              {groups.chats.map((op) => (
                <DecisionCard
                  key={op.id}
                  operation={op}
                  animate={false}
                  onOpen={() => open(op)}
                  {...(op.gate?.kind === 'tool_permission'
                    ? { onPermission: (behavior: 'allow' | 'deny') => onPermission(op, behavior) }
                    : {})}
                />
              ))}
            </>
          ) : null}

          {groups.runs.length > 0 ? (
            <>
              <SectionHeader title={`Runs (${groups.runs.length})`} />
              {groups.runs.map((op) => (
                <DecisionCard key={op.id} operation={op} animate={false} onOpen={() => open(op)} />
              ))}
              <Text className="px-1 text-xs leading-relaxed text-muted-foreground">
                A blocked stage is approved on the run itself, where its output is.
              </Text>
            </>
          ) : null}
        </View>
      )}
    </RouteSheet>
  );
}

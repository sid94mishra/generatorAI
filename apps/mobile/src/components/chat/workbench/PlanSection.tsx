// ────────────────────────────────────────────────────────────────
// Workbench › Plan.
//
// The plan document, its revisions, and its decision state. Editing the plan
// body is a desktop affordance — precise text editing on a phone is worse
// than useless — but reading it, and deciding on it, are exactly the things
// someone wants to do away from their desk.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { Markdown } from '../../markdown/Markdown';
import { Badge, type Tone } from '../../ui/primitives';
import { Touchable } from '../../ui/Touchable';
import { EmptyState, ErrorState, LoadingState } from '../../ui/States';
import { useApi } from '../../../api/useApi';
import { useTheme } from '../../../theme/ThemeProvider';

const STATUS_TONE: Record<string, Tone> = {
  awaiting_review: 'primary',
  approved: 'success',
  changes_requested: 'warning',
  rejected: 'danger',
  expired: 'neutral',
};

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function PlanSection({ chatId }: { chatId: string }): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const [selected, setSelected] = useState<string | null>(null);

  const plans = useQuery({
    queryKey: queryKeys.chatPlans(chatId),
    queryFn: () => api.chats.plans(chatId),
  });

  const active = selected
    ? plans.data?.find((p) => p.planId === selected)
    : // Default to the plan that needs a decision, falling back to the newest.
      (plans.data?.find((p) => p.status === 'awaiting_review') ?? plans.data?.[0]);

  const content = useQuery({
    queryKey: ['chats', chatId, 'plans', active?.planId ?? '', 'content', active?.revision ?? 0],
    queryFn: () => api.chats.planContent(chatId, active!.planId),
    enabled: Boolean(active?.planId),
  });

  if (plans.isLoading) return <LoadingState label="Loading plans…" />;
  if (plans.isError) {
    return <ErrorState message="Could not load plans." onRetry={() => void plans.refetch()} />;
  }
  if (!plans.data || plans.data.length === 0) {
    return (
      <EmptyState
        title="No plan yet"
        message="Switch the composer to “Plan first” and the agent will write one before it changes anything."
        icon={<ScrollText size={22} color={colors['muted-foreground']} />}
      />
    );
  }

  return (
    <View className="flex-1">
      {plans.data.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}
        >
          {plans.data.map((plan) => {
            const isActive = plan.planId === active?.planId;
            return (
              <Touchable
                key={plan.planId}
                accessibilityLabel={plan.title}
                haptic="select"
                onPress={() => setSelected(plan.planId)}
                className={`h-8 justify-center rounded-full border px-3 ${
                  isActive ? 'border-primary bg-accent' : 'border-border bg-raised'
                }`}
              >
                <Text
                  numberOfLines={1}
                  className={`max-w-40 text-xs ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                >
                  {plan.title}
                </Text>
              </Touchable>
            );
          })}
        </ScrollView>
      ) : null}

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}>
        {active ? (
          <>
            <View className="gap-2">
              <Text className="text-xl font-bold text-foreground">{active.title}</Text>
              <View className="flex-row items-center gap-2">
                <Badge
                  label={statusLabel(active.status)}
                  tone={STATUS_TONE[active.status] ?? 'neutral'}
                />
                <Text className="text-xs text-muted-foreground">Revision {active.revision}</Text>
              </View>
            </View>

            {content.isLoading ? (
              <LoadingState />
            ) : content.isError ? (
              <ErrorState
                message="Could not load the plan document."
                onRetry={() => void content.refetch()}
              />
            ) : (
              <Markdown content={content.data?.content ?? active.summary} />
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

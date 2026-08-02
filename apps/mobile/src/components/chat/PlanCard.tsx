// ────────────────────────────────────────────────────────────────
// Plan card — the review gate.
//
// The web version lives inline in the transcript with a Review button that
// opens the Plan tab. On mobile it is PINNED above the composer instead:
// during a long turn the transcript keeps growing, and a decision that scrolls
// out of reach is a decision the user cannot make. Pinning also means the
// disabled composer and the reason for it are adjacent.
//
// Actions come from the server (`plan.actions`) rather than being hard-coded,
// so a new outcome appears here without a client change.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ClipboardList, FileText } from 'lucide-react-native';
import type { PlanSummary } from '@generatorai/client-core';

import { Button } from '../ui/Button';
import { Badge } from '../ui/primitives';
import { Touchable } from '../ui/Touchable';
import { toGateAction } from './gateActions';
import { useTheme } from '../../theme/ThemeProvider';

export function PlanCard({
  plan,
  onDecide,
  onOpenPlan,
  busy = false,
}: {
  plan: PlanSummary;
  onDecide: (action: string) => Promise<void> | void;
  onOpenPlan: () => void;
  busy?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const [pending, setPending] = useState<string | null>(null);

  const actions = plan.actions.map(toGateAction);

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18)}
      className="mx-3 mb-2 gap-3 rounded-3xl border border-primary bg-card p-3.5"
    >
      <View className="flex-row items-center gap-2.5">
        <View className="h-8 w-8 items-center justify-center rounded-2xl bg-accent">
          <ClipboardList size={16} color={colors.primary} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={2} className="text-md font-semibold text-foreground">
            {plan.title}
          </Text>
          <Text className="text-xs text-muted-foreground">
            Revision {plan.revision} · waiting for your review
          </Text>
        </View>
        <Badge label="Plan" tone="primary" />
      </View>

      {plan.summary ? (
        <Text numberOfLines={4} className="text-sm leading-relaxed text-muted-foreground">
          {plan.summary}
        </Text>
      ) : null}

      <Touchable
        accessibilityLabel="Read the full plan"
        haptic="tap"
        onPress={onOpenPlan}
        className="flex-row items-center gap-2 self-start rounded-2xl bg-subtle px-3 py-2"
      >
        <FileText size={14} color={colors['muted-foreground']} />
        <Text className="text-sm text-muted-foreground">
          {plan.fileName ?? 'Read the full plan'}
        </Text>
      </Touchable>

      <View className="flex-row flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.id}
            label={action.label}
            size="sm"
            variant={
              action.tone === 'primary' ? 'primary' : action.tone === 'danger' ? 'danger' : 'secondary'
            }
            loading={pending === action.id}
            disabled={busy || pending !== null}
            onPress={async () => {
              setPending(action.id);
              try {
                await onDecide(action.id);
              } finally {
                setPending(null);
              }
            }}
          />
        ))}
      </View>
    </Animated.View>
  );
}

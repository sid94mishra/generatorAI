// ────────────────────────────────────────────────────────────────
// Plan card — the review gate.
//
// The web version lives inline in the transcript with a Review button that
// opens the Plan tab. On mobile it is PINNED above the composer instead:
// during a long turn the transcript keeps growing, and a decision that scrolls
// out of reach is a decision the user cannot make. Pinning also means the
// disabled composer and the reason for it are adjacent.
//
// Actions are the three a reviewer actually takes — Approve & implement,
// Request changes (with the note the agent needs), Open plan — plus
// "Approve & run autonomously" when the server offers it. The server's
// `plan.actions` list decides which of those are shown, so a server that
// withholds autopilot never sees it offered; an action id this build does
// not recognise still renders (neutral) rather than leaving the gate stuck.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { ClipboardList, FileText } from 'lucide-react-native';
import type { PlanSummary } from '@generatorai/client-core';

import { Button } from '../ui/Button';
import { Badge } from '../ui/primitives';
import { Touchable } from '../ui/Touchable';
import { planCardActions, type GateAction } from './gateActions';
import { useTheme } from '../../theme/ThemeProvider';
import { useCardEntering } from '../common/enterMotion';

export function PlanCard({
  plan,
  onDecide,
  onOpenPlan,
  busy = false,
}: {
  plan: PlanSummary;
  /** `feedback` is set for "Request changes". */
  onDecide: (action: string, feedback?: string) => Promise<void> | void;
  onOpenPlan: () => void;
  busy?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const entering = useCardEntering();
  const [pending, setPending] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<GateAction | null>(null);
  const [feedback, setFeedback] = useState('');

  const actions = useMemo(() => planCardActions(plan.actions), [plan.actions]);

  const run = async (action: GateAction, note?: string): Promise<void> => {
    setPending(action.id);
    try {
      await onDecide(action.id, note);
    } finally {
      setPending(null);
      setRequesting(null);
    }
  };

  return (
    <Animated.View
      entering={entering}
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
        accessibilityLabel="Open the full plan"
        haptic="tap"
        onPress={onOpenPlan}
        className="flex-row items-center gap-2 self-start rounded-2xl bg-subtle px-3 py-2"
      >
        <FileText size={14} color={colors['muted-foreground']} />
        <Text className="text-sm text-muted-foreground">Open plan{plan.fileName ? ` · ${plan.fileName}` : ''}</Text>
      </Touchable>

      {requesting ? (
        <Animated.View entering={FadeIn.duration(120)} className="gap-2">
          <TextInput
            accessibilityLabel="What should change?"
            multiline
            autoFocus
            value={feedback}
            onChangeText={setFeedback}
            placeholder="What should change?"
            placeholderTextColor={colors['muted-foreground']}
            className="max-h-32 min-h-11 rounded-2xl border border-border bg-raised px-3 py-2.5 text-sm text-foreground"
          />
          <View className="flex-row gap-2">
            <Button label="Back" variant="secondary" size="sm" disabled={pending !== null} onPress={() => setRequesting(null)} />
            <Button
              label="Send request"
              size="sm"
              grow
              loading={pending === requesting.id}
              disabled={busy || pending !== null || !feedback.trim()}
              onPress={() => void run(requesting, feedback.trim())}
            />
          </View>
        </Animated.View>
      ) : (
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
              onPress={() => {
                if (action.wantsFeedback) {
                  setFeedback('');
                  setRequesting(action);
                  return;
                }
                void run(action);
              }}
            />
          ))}
        </View>
      )}
    </Animated.View>
  );
}

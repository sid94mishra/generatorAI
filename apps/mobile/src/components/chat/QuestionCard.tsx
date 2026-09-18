// ────────────────────────────────────────────────────────────────
// Question card — the agent's clarifying questions.
//
// Pinned above the composer for the same reason as the plan card: it is a
// decision, and a decision that scrolls away is a decision that stalls the
// turn. Supports the full server model — several questions per interaction,
// single- or multi-select, plus an optional freeform answer.
//
// The submit button stays disabled until every question has an answer,
// because a partial response makes the agent ask again and the user has no
// way to tell why.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Check, CircleHelp } from 'lucide-react-native';
import type { StreamBlock } from '@generatorai/client-core';

import { Button } from '../ui/Button';
import { Touchable } from '../ui/Touchable';
import { useTheme } from '../../theme/ThemeProvider';
import { useCardEntering } from '../common/enterMotion';
import { GateScroll } from './GateScroll';

type QuestionBlock = Extract<StreamBlock, { type: 'question' }>;

export function QuestionCard({
  block,
  onSubmit,
}: {
  block: QuestionBlock;
  onSubmit: (answers: Record<string, string[]>, freeform: string | undefined) => Promise<void> | void;
}): React.ReactElement {
  const { colors } = useTheme();
  const entering = useCardEntering();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [freeform, setFreeform] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (questionId: string, label: string, multi: boolean): void => {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      if (!multi) return { ...prev, [questionId]: current[0] === label ? [] : [label] };
      return {
        ...prev,
        [questionId]: current.includes(label)
          ? current.filter((v) => v !== label)
          : [...current, label],
      };
    });
  };

  // A question that allows freeform is satisfied by typed text alone, which
  // is why the freeform box counts toward completeness rather than being
  // treated as an optional extra.
  const complete = useMemo(
    () =>
      block.questions.every((q) => {
        const picked = answers[q.id] ?? [];
        if (picked.length > 0) return true;
        return q.allowFreeform && freeform.trim().length > 0;
      }),
    [block.questions, answers, freeform],
  );

  const allowsFreeform = block.questions.some((q) => q.allowFreeform);

  return (
    <Animated.View
      entering={entering}
      className="mx-3 mt-2 gap-3 rounded-3xl border border-warning bg-card p-3.5"
    >
      <View className="flex-row items-center gap-2.5">
        <View className="h-8 w-8 items-center justify-center rounded-2xl bg-warning-muted">
          <CircleHelp size={16} color={colors.warning} />
        </View>
        <Text className="flex-1 text-md font-semibold text-foreground">The agent has a question</Text>
      </View>

      <GateScroll>
        {block.questions.map((question) => {
          const picked = answers[question.id] ?? [];
          return (
            <View key={question.id} className="gap-2">
              <Text className="text-sm font-medium text-foreground">{question.question}</Text>
              <View className="gap-1.5">
                {question.options.map((option) => {
                  const selected = picked.includes(option.label);
                  return (
                    <Touchable
                      key={option.label}
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected }}
                      haptic="select"
                      scale="large"
                      onPress={() => toggle(question.id, option.label, question.multiSelect)}
                      className={`min-h-11 flex-row items-center gap-2.5 rounded-2xl border px-3 py-2.5 ${
                        selected ? 'border-primary bg-accent' : 'border-border bg-raised'
                      }`}
                    >
                      <View
                        className={`h-5 w-5 items-center justify-center border ${
                          question.multiSelect ? 'rounded-md' : 'rounded-full'
                        } ${selected ? 'border-primary bg-primary' : 'border-border'}`}
                      >
                        {selected ? <Check size={12} color={colors['primary-foreground']} /> : null}
                      </View>
                      <View className="flex-1">
                        <Text className="text-sm text-foreground">{option.label}</Text>
                        {option.description ? (
                          <Text className="text-xs text-muted-foreground">{option.description}</Text>
                        ) : null}
                      </View>
                    </Touchable>
                  );
                })}
              </View>
            </View>
          );
        })}

        {allowsFreeform ? (
          <TextInput
            accessibilityLabel="Your answer"
            multiline
            value={freeform}
            onChangeText={setFreeform}
            placeholder="Add anything else…"
            placeholderTextColor={colors['muted-foreground']}
            className="max-h-28 min-h-11 rounded-2xl border border-border bg-raised px-3 py-2.5 text-sm text-foreground"
          />
        ) : null}
      </GateScroll>

      <Button
        label="Send answer"
        full
        disabled={!complete}
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await onSubmit(answers, freeform.trim() ? freeform.trim() : undefined);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Animated.View>
  );
}

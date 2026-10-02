// MB-11 StepRow + MB-16 InlineError: one tool step — status glyph (StatusBadge glyph), verb 600 + mono target
// (middle-truncated), an outcome line (failure in err, "50 of 50 passed", DiffStat for edits), mono duration, and a
// chevron to the step detail (MB-14). A failed step carries its excerpt below (max 12 lines + "Show all").
import React, { memo, useState } from 'react';
import { View } from 'react-native';
import { formatStepDuration, transcriptStepStatus, type TimelineStep } from '@generatorai/client-core';
import { STATUS_STATE_DEFS } from '@generatorai/shared';
import type { MobileIconConcept } from '@generatorai/design-tokens';

import { Icon } from '../../../ui/primitives/Icon';
import { DiffStat } from '../../../ui/primitives/DiffStat';
import { Pressable } from '../../../ui/primitives/Pressable';
import { Spinner } from '../../../ui/primitives/Spinner';
import { Text } from '../../../ui/primitives/Text';
import { errorExcerpt, stepOutcome } from '../model/stepModel';
import { useTranscriptActions } from '../transcriptContext';

export function StepGlyph({ step, size = 16 }: { step: Pick<TimelineStep, 'status'>; size?: 14 | 16 | 18 }): React.ReactElement {
  if (step.status === 'running') return <Spinner size={size === 18 ? 16 : size} />;
  const def = STATUS_STATE_DEFS[transcriptStepStatus(step.status).state];
  return <Icon concept={def.glyph as MobileIconConcept} size={size} tone={def.tone} />;
}

export function InlineError({ text, testID }: { text: string; testID?: string }): React.ReactElement | null {
  const [all, setAll] = useState(false);
  const excerpt = errorExcerpt(text, all ? Number.MAX_SAFE_INTEGER : 12);
  if (!excerpt) return null;
  const [first, ...rest] = excerpt.lines;
  return (
    <View testID={testID} accessibilityRole="alert" className="gap-0.5 rounded-badge border border-line-soft bg-sunken px-3 py-2.5">
      <Text role="monoSm" tone="err" selectable>{`✕ ${first ?? ''}`}</Text>
      {rest.length ? (
        <Text role="monoSm" tone="fg-2" selectable>
          {rest.join('\n')}
        </Text>
      ) : null}
      {excerpt.more ? (
        <Pressable onPress={() => setAll(true)} accessibilityRole="button" accessibilityLabel="Show the whole error" className="self-start">
          <Text role="footnote" weight={500} tone="fg-2">
            Show all
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const StepRow = memo(function StepRow({ step }: { step: TimelineStep }): React.ReactElement {
  const { onOpenStep } = useTranscriptActions();
  const outcome = stepOutcome(step);
  const duration = formatStepDuration(step.durationMs);
  const open = step.callId && onOpenStep ? () => onOpenStep(step.callId!) : undefined;
  const label = [step.verb, step.target, outcome?.text, duration].filter(Boolean).join(', ');
  return (
    <View>
      <Pressable
        onPress={open}
        disabled={!open}
        frame="none"
        accessibilityRole={open ? 'button' : 'text'}
        accessibilityLabel={label}
        accessibilityHint={open ? 'Opens the step' : undefined}
        testID={step.callId ? `step-row-${step.callId}` : undefined}
        className="min-h-step flex-row items-center gap-2.5 py-1 pe-3 ps-3.5"
      >
        <StepGlyph step={step} />
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-baseline gap-1.5">
            <Text role="subhead" weight={600} numberOfLines={1} className="shrink-0">
              {step.verb}
            </Text>
            {step.target ? (
              <Text role={step.mono === false ? 'subhead' : 'monoSm'} tone="fg-2" numberOfLines={1} ellipsizeMode="middle" className="shrink">
                {step.target}
              </Text>
            ) : null}
          </View>
          {step.fileOp ? (
            <DiffStat additions={step.fileOp.additions} deletions={step.fileOp.deletions} />
          ) : outcome ? (
            <Text role="footnote" tone={outcome.tone} numberOfLines={1}>
              {outcome.text}
            </Text>
          ) : null}
        </View>
        {duration ? (
          <Text role="monoSm" tone="fg-3" chrome>
            {duration}
          </Text>
        ) : null}
        {open ? <Icon concept="chevron-right" size={14} tone="fg-3" /> : null}
      </Pressable>
      {step.status === 'failed' && step.errorText ? (
        <View className="pb-2 pe-3 ps-10">
          <InlineError text={step.errorText} />
        </View>
      ) : null}
    </View>
  );
});

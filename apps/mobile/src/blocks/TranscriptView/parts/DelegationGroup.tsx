// MB-17 DelegationGroup: an orchestrator's delegated work in the transcript — "Background tasks" + count + "Open ›"
// (the pane's Tasks tab), then one row per worker: status glyph, task title, worker name, mono elapsed or "Queued".
// A row opens the worker's own chat.
import React, { memo } from 'react';
import { View } from 'react-native';
import { formatStepDuration, type TimelineStep } from '@generatorai/client-core';
import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';

import { Count } from '../../../ui/primitives/Count';
import { Icon } from '../../../ui/primitives/Icon';
import { Pressable } from '../../../ui/primitives/Pressable';
import { Separator } from '../../../ui/primitives/Separator';
import { Text } from '../../../ui/primitives/Text';
import { useTranscriptActions } from '../transcriptContext';
import { StepGlyph } from './StepRow';

/** The worker's name: the step's model child when present (`bgt-…-model`), else nothing. */
function workerName(step: TimelineStep): string | null {
  const child = step.children?.find((c) => c.id.endsWith('-model'));
  return child?.target || null;
}

export const DelegationGroup = memo(function DelegationGroup({ steps }: { steps: TimelineStep[] }): React.ReactElement {
  const { onOpenTasks, onOpenChat } = useTranscriptActions();
  return (
    <View testID="delegation-group" className="overflow-hidden rounded-card border border-line-soft">
      <Pressable
        onPress={onOpenTasks}
        disabled={!onOpenTasks}
        frame="none"
        accessibilityRole="button"
        accessibilityLabel={`${TRANSCRIPT_COPY.delegated(steps.length)}. Open background tasks`}
        className="min-h-step flex-row items-center gap-2 px-3 py-2"
      >
        <Icon concept="tasks" size={16} tone="fg-2" />
        <Text role="footnote" weight={600} tone="fg-2">
          Background tasks
        </Text>
        <Count value={steps.length} />
        <View className="flex-1" />
        {onOpenTasks ? (
          <>
            <Text role="footnote" weight={600}>
              Open
            </Text>
            <Icon concept="chevron-right" size={14} tone="fg" />
          </>
        ) : null}
      </Pressable>
      {steps.map((step) => {
        const worker = workerName(step);
        const elapsed = step.status === 'pending' ? 'Queued' : formatStepDuration(step.durationMs);
        const open = step.workerChatId && onOpenChat ? () => onOpenChat(step.workerChatId!) : undefined;
        return (
          <React.Fragment key={step.id}>
            <Separator />
            <Pressable
              onPress={open}
              disabled={!open}
              frame="none"
              accessibilityRole={open ? 'button' : 'text'}
              accessibilityLabel={[step.target, worker, elapsed].filter(Boolean).join(', ')}
              accessibilityHint={open ? TRANSCRIPT_COPY.openWorkerChat : undefined}
              className="min-h-item flex-row items-center gap-2.5 px-3 py-1.5"
            >
              <StepGlyph step={step} />
              <View className="flex-1">
                <Text role="subhead" numberOfLines={1}>
                  {step.target || step.verb}
                </Text>
                {worker ? (
                  <Text role="caption" tone="fg-3" numberOfLines={1}>
                    {worker}
                  </Text>
                ) : null}
              </View>
              {elapsed ? (
                <Text role="monoSm" tone={step.status === 'running' ? 'run' : 'fg-3'}>
                  {elapsed}
                </Text>
              ) : null}
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
});

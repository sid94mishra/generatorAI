// MB-13 StepGroupCard ("tool block", principle 7): consecutive tool calls read as one step. Collapsed: `layers`,
// the title in words ("Read 3 files, ran 2 commands, edited 1 file"), "1 failed" · mono "6 steps · 2m 44s",
// chevron. Running: spinner, "Reading files… 3 so far" and the current step under a divider. Expanded in place:
// the StepRows on `bg-raised`. A single step is one StepRow in the same frame.
import React, { memo, useState } from 'react';
import { View } from 'react-native';
import type { TimelineStep } from '@generatorai/client-core';

import { cn } from '../../../ui/lib/cn';
import { Icon } from '../../../ui/primitives/Icon';
import { Pressable } from '../../../ui/primitives/Pressable';
import { Separator } from '../../../ui/primitives/Separator';
import { Spinner } from '../../../ui/primitives/Spinner';
import { Text } from '../../../ui/primitives/Text';
import { toolBlockLabel, toolBlockSummary } from '../model/stepModel';
import { StepGlyph, StepRow } from './StepRow';

export const StepGroupCard = memo(function StepGroupCard({ steps }: { steps: TimelineStep[] }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const summary = toolBlockSummary(steps);
  if (steps.length === 1) {
    return (
      <View className="overflow-hidden rounded-card border border-line-soft">
        <StepRow step={steps[0]!} />
      </View>
    );
  }
  return (
    <View testID="tool-block" className={cn('overflow-hidden rounded-card border', summary.running ? 'border-line' : 'border-line-soft')}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        frame="none"
        accessibilityRole="button"
        accessibilityLabel={toolBlockLabel(summary)}
        accessibilityState={{ expanded }}
        className="min-h-step flex-row items-center gap-2.5 px-3 py-2.5"
      >
        {summary.running ? <Spinner size={16} /> : <Icon concept="layers" size={18} tone="fg-2" />}
        <View className="flex-1 gap-0.5">
          <Text role="subhead" weight={600} numberOfLines={2}>
            {summary.title}
          </Text>
          <Text role="footnote" tone="fg-3" numberOfLines={1}>
            {summary.failed ? <Text role="footnote" tone="err">{`${summary.failed} failed · `}</Text> : null}
            <Text role="monoSm" tone="fg-3">
              {summary.meta}
            </Text>
          </Text>
        </View>
        <Icon concept={expanded ? 'chevron-up' : 'chevron-down'} size={16} tone="fg-3" />
      </Pressable>
      {!expanded && summary.current ? (
        <>
          <Separator />
          <View className="min-h-step flex-row items-center gap-2.5 py-1.5 pe-3 ps-8" accessibilityLabel={`${summary.current.verb} ${summary.current.target}`}>
            <StepGlyph step={summary.current} size={14} />
            <Text role="footnote" tone="fg-2">
              {summary.current.verb}
            </Text>
            <Text role="monoSm" tone="fg" numberOfLines={1} ellipsizeMode="middle" className="flex-1">
              {summary.current.target}
            </Text>
          </View>
        </>
      ) : null}
      {expanded ? (
        <View className="bg-raised">
          {steps.map((step) => (
            <React.Fragment key={step.id}>
              <Separator />
              <StepRow step={step} />
            </React.Fragment>
          ))}
        </View>
      ) : null}
    </View>
  );
});

// MP-15 ProgressSegments (03 MP-15; MD-67): one segment per stage in its status tone. The bar is hidden from
// screen readers: it always sits next to a text equivalent ("Stage 2 of 6 · Assess risk"), per MD-67.
import React from 'react';
import { View } from 'react-native';
import { STATUS_STATE_DEFS, type StatusState } from '@generatorai/shared';
import type { MobileIconConcept } from '@generatorai/design-tokens';

import { cn } from '../../lib/cn';
import { Icon } from '../Icon';
import { Text } from '../Text';
import type { ProgressSegmentsProps } from './ProgressSegments.types';

export type { ProgressSegmentsProps } from './ProgressSegments.types';

/** Segment fill per stage state (MD-67): pending stages are line-strong, skipped fg-3. */
export const SEGMENT_FILL: Record<StatusState, string> = {
  queued: 'bg-line-strong',
  waiting: 'bg-line-strong',
  paused: 'bg-line-strong',
  running: 'bg-run',
  needs_you: 'bg-warn',
  succeeded: 'bg-ok',
  failed: 'bg-err',
  skipped: 'bg-fg-3',
};
const HEIGHT = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' } as const;

export function segmentFraction(segments: ProgressSegmentsProps['segments']): string {
  return `${segments.filter((s) => s.state === 'succeeded').length}/${segments.length}`;
}

export function ProgressSegments({ segments, size = 'sm', showFraction = false, tracker, testID }: ProgressSegmentsProps): React.ReactElement {
  return (
    <View testID={testID} className="flex-row items-center gap-2">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="flex-1 flex-row items-center gap-0.75">
        {segments.map((segment, i) =>
          i === tracker ? (
            <View key={i} className="flex-1 flex-row items-center gap-0.75">
              <View className={cn('flex-1 rounded-full', HEIGHT[size], SEGMENT_FILL[segment.state])} />
              <View className={cn('size-6 items-center justify-center rounded-full', SEGMENT_FILL[segment.state])}>
                <Icon concept={STATUS_STATE_DEFS[segment.state].glyph as MobileIconConcept} size={14} tone="on-accent" />
              </View>
              <View className={cn('flex-1 rounded-full', HEIGHT[size], 'bg-line-strong')} />
            </View>
          ) : (
            <View key={i} className={cn('flex-1 rounded-full', HEIGHT[size], SEGMENT_FILL[segment.state])} />
          ),
        )}
      </View>
      {showFraction ? (
        <Text role="monoSm" tone="fg-3">
          {segmentFraction(segments)}
        </Text>
      ) : null}
    </View>
  );
}

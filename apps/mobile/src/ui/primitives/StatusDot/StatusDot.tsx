// MP-08 StatusDot (03 MP-08): the dense-row dot; colour from the shared status or health tone.
import React from 'react';
import { View } from 'react-native';
import { STATUS_STATE_DEFS, type HealthTone, type StatusTone } from '@generatorai/shared';

import { cn } from '../../lib/cn';
import type { StatusDotProps } from './StatusDot.types';

export type { StatusDotProps } from './StatusDot.types';

const FILL: Record<StatusTone | HealthTone, string> = {
  'fg-2': 'bg-fg-2',
  'fg-3': 'bg-fg-3',
  idle: 'bg-fg-3',
  run: 'bg-run',
  ok: 'bg-ok',
  warn: 'bg-warn',
  err: 'bg-err',
};
const RING: Record<StatusTone | HealthTone, string> = {
  'fg-2': 'border-fg-2',
  'fg-3': 'border-fg-3',
  idle: 'border-fg-3',
  run: 'border-run',
  ok: 'border-ok',
  warn: 'border-warn',
  err: 'border-err',
};

export function statusDotTone(state?: StatusDotProps['state'], health?: HealthTone): StatusTone | HealthTone {
  if (state) return STATUS_STATE_DEFS[state].tone;
  return health ?? 'idle';
}

export function StatusDot({ state, health, size = 'md', ring = false, hollow = false, label, testID }: StatusDotProps): React.ReactElement {
  const tone = statusDotTone(state, health);
  const a11y = label
    ? { accessible: true, accessibilityRole: 'text' as const, accessibilityLabel: label }
    : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };
  const dot = (
    <View
      className={cn('rounded-full', size === 'sm' ? 'size-1.5' : ring ? 'size-1.75' : 'size-2', hollow ? cn('border', RING[tone]) : FILL[tone])}
    />
  );
  if (!ring) {
    return (
      <View testID={testID} {...a11y}>
        {dot}
      </View>
    );
  }
  return (
    <View testID={testID} {...a11y} className="size-2.75 items-center justify-center rounded-full bg-ground">
      {dot}
    </View>
  );
}

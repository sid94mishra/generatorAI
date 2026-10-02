// ML-21 Stepper (03 ML-21; MD-66). Wizard: numbered 24 nodes joined by 1px lines — done = fg fill + ✓ (surface),
// current = 2px fg ring + number, pending = 1px line-strong ring + fg-3 number. Phones show only the current label
// (caption) and the nodes are not buttons; `medium` shows every label (finished steps pressable when onStepPress);
// `expanded` is vertical. Inline: "1 Request › 2 Admin approves › 3 Edit".
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { useSizeClass } from '../../platform/breakpoints';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { StepperProps } from './Stepper.types';
import { stepState, stepperLabel, type StepState } from './stepperModel';

export type { StepperProps, StepperStep } from './Stepper.types';

function Node({ index, state }: { index: number; state: StepState }): React.ReactElement {
  return (
    <View
      className={cn(
        'size-6 items-center justify-center rounded-full',
        state === 'done' ? 'bg-fg' : state === 'current' ? 'border-2 border-fg' : 'border border-line-strong',
      )}
    >
      {state === 'done' ? (
        <Icon concept="check" size={14} tone="surface" />
      ) : (
        <Text role="monoSm" tone={state === 'current' ? 'fg' : 'fg-3'} chrome>
          {String(index + 1)}
        </Text>
      )}
    </View>
  );
}

export function Stepper({ steps, current, done, variant = 'wizard', onStepPress, testID }: StepperProps): React.ReactElement {
  const size = useSizeClass().sizeClass;
  const label = stepperLabel(current, steps.length, steps[current]?.label ?? '');

  if (variant === 'inline') {
    return (
      <View testID={testID} accessible accessibilityLabel={label} className="flex-row flex-wrap items-center gap-1.5">
        {steps.map((s, i) => (
          <React.Fragment key={s.id}>
            {i > 0 ? <Icon concept="chevron-right" size={12} tone="fg-3" /> : null}
            <Text role="footnote" weight={i === current ? 600 : 400} tone={i === current ? 'fg' : 'fg-3'}>
              {`${i + 1} ${s.label}`}
            </Text>
          </React.Fragment>
        ))}
      </View>
    );
  }

  const vertical = size === 'expanded';
  const labels = size !== 'compact';
  return (
    <View testID={testID} accessible={!labels || !onStepPress} accessibilityLabel={label} className={cn(vertical ? 'gap-2' : 'gap-2')}>
      <View className={cn(vertical ? 'gap-3' : 'flex-row items-center')}>
        {steps.map((s, i) => {
          const state = stepState(i, current, done);
          const pressable = labels && onStepPress && state === 'done';
          const node = (
            <View className={cn('items-center gap-2', vertical && 'flex-row')}>
              <Node index={i} state={state} />
              {labels ? (
                <Text role="caption" tone={state === 'pending' ? 'fg-3' : 'fg'} numberOfLines={1}>
                  {s.label}
                </Text>
              ) : null}
            </View>
          );
          return (
            <React.Fragment key={s.id}>
              {i > 0 && !vertical ? <View className="mx-1 h-px flex-1 bg-line" /> : null}
              {pressable ? (
                <Pressable onPress={() => onStepPress(i)} accessibilityRole="button" accessibilityLabel={`Go to step ${i + 1}, ${s.label}`} feedback="none">
                  {node}
                </Pressable>
              ) : (
                node
              )}
            </React.Fragment>
          );
        })}
      </View>
      {labels ? null : (
        <Text role="caption" tone="fg-2" align="center">
          {steps[current]?.label}
        </Text>
      )}
    </View>
  );
}

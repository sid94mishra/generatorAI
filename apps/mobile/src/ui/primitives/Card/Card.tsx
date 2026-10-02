// MP-46 Card (03 MP-46): bg-raised, token radius, optional line-soft border, no shadow; pressable wraps Pressable.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { Pressable } from '../Pressable';
import type { CardProps } from './Card.types';

export type { CardProps } from './Card.types';

const RADIUS = { card: 'rounded-card', group: 'rounded-group', gate: 'rounded-card-lg', tile: 'rounded-card-lg' } as const;
const PADDING = { none: '', sm: 'p-2', md: 'py-3 ios:px-3.5 android:px-4' } as const;

export function cardClass(radius: NonNullable<CardProps['radius']>, outlined: boolean, padding: NonNullable<CardProps['padding']>): string {
  return cn('bg-raised', RADIUS[radius], outlined && 'border border-line-soft', PADDING[padding]);
}

export function Card({ radius = 'card', outlined = false, padding = 'md', onPress, accessibilityLabel, children, testID }: CardProps): React.ReactElement {
  const className = cardClass(radius, outlined, padding);
  if (!onPress) {
    return (
      <View testID={testID} accessibilityLabel={accessibilityLabel} className={className}>
        {children}
      </View>
    );
  }
  return (
    <Pressable testID={testID} onPress={onPress} frame="none" feedback="scale" large accessibilityLabel={accessibilityLabel} className={cn(className, 'overflow-hidden')}>
      {children}
    </Pressable>
  );
}

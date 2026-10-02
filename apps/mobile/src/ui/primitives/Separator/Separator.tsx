// MP-36 Separator (03 MP-36): hairline (iOS) / 1 dp rule in line-soft; start insets; the menu band.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { hairline } from '../../platform/geometry';
import type { SeparatorProps } from './Separator.types';

export type { SeparatorProps } from './Separator.types';

const INSET = { 0: '', 16: 'ms-4', 48: 'ms-12', 56: 'ms-14' } as const;

export function Separator({ orientation = 'horizontal', inset = 0, variant = 'line', testID }: SeparatorProps): React.ReactElement {
  const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };
  if (variant === 'band') return <View testID={testID} {...hidden} className="h-2 bg-hover" />;
  const rule = hairline();
  if (orientation === 'vertical') {
    return <View testID={testID} {...hidden} className="self-stretch bg-line-soft" style={{ width: rule }} />;
  }
  return <View testID={testID} {...hidden} className={cn('bg-line-soft', INSET[inset])} style={{ height: rule }} />;
}

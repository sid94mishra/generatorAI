// MP-09 Count — a mono count, a bubble, or a dot (03 MP-09). Mono 12 minimum (MD-28), chrome-capped.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { formatCount } from '../../lib/format';
import { Text } from '../Text';
import type { CountProps } from './Count.types';

export type { CountProps } from './Count.types';

const hiddenProps = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };

export function Count({ value, tone = 'fg-3', form = 'inline', max, hidden = false, testID }: CountProps): React.ReactElement {
  const a11y = hidden ? hiddenProps : {};
  if (form === 'dot') {
    return <View testID={testID} {...hiddenProps} className={cn('size-1.5 rounded-full', tone === 'run' ? 'bg-run' : 'bg-warn')} />;
  }
  const text = formatCount(value, max);
  if (form === 'bubble') {
    return (
      <View
        testID={testID}
        {...a11y}
        className={cn('h-4 min-w-4 items-center justify-center rounded-full px-1', tone === 'run' ? 'bg-run' : 'bg-fg')}
      >
        <Text role="monoSm" chrome tone={tone === 'run' ? 'on-accent' : 'surface'}>
          {text}
        </Text>
      </View>
    );
  }
  return (
    <View testID={testID} {...a11y}>
      <Text role="monoSm" chrome tone={tone}>
        {text}
      </Text>
    </View>
  );
}

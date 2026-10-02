// MP-12 Spinner (03 MP-12): the running glyph turning 1 s linear; static under Reduce Motion.
import React from 'react';
import { View } from 'react-native';

import { Icon } from '../Icon';
import type { SpinnerProps } from './Spinner.types';

export type { SpinnerProps } from './Spinner.types';

export function Spinner({ size = 16, tone = 'run', label, testID }: SpinnerProps): React.ReactElement {
  if (!label) return <Icon concept="loader" size={size} tone={tone} spinning testID={testID} />;
  return (
    <View testID={testID} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }}>
      <Icon concept="loader" size={size} tone={tone} spinning />
    </View>
  );
}

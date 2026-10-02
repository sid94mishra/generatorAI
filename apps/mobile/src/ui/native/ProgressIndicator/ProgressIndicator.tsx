// MP-13 ProgressIndicator — Jest / web fallback: RN ActivityIndicator in fg-2 (the native files use Expo UI).
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import type { ProgressIndicatorProps } from './ProgressIndicator.types';
import { toProgressIndicatorNativeProps } from './progressIndicatorModel';

export type { ProgressIndicatorProps } from './ProgressIndicator.types';

export function ProgressIndicator(props: ProgressIndicatorProps): React.ReactElement {
  const native = toProgressIndicatorNativeProps(props, useThemeColors());
  return (
    <View testID={props.testID} accessible accessibilityRole="progressbar" accessibilityLabel={props.label} accessibilityState={{ busy: true }}>
      <ActivityIndicator size={native.controlSize === 'large' ? 'large' : 'small'} color={native.color} />
    </View>
  );
}

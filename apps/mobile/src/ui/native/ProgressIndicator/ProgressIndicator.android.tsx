// MP-13 ProgressIndicator — Android: the M3 Expressive LoadingIndicator (contained over content) through Expo UI.
// Reduce Motion stops the morph: a static loader glyph instead. A client without ExpoUI draws ActivityIndicator.
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type * as Compose from '@expo/ui/jetpack-compose';
import type * as ComposeModifiers from '@expo/ui/jetpack-compose/modifiers';

import { useThemeColors } from '../../lib/themeColors';
import { useReduceMotion } from '../../platform/motion';
import { Icon } from '../../primitives/Icon';
import type { ProgressIndicatorProps } from './ProgressIndicator.types';
import { toProgressIndicatorNativeProps } from './progressIndicatorModel';

export type { ProgressIndicatorProps } from './ProgressIndicator.types';

/** Expo UI, loaded only when this client has its native module (the barrel registers native views on import). */
const expoUi: { ui: typeof Compose; modifiers: typeof ComposeModifiers } | null =
  requireOptionalNativeModule('ExpoUI') === null
    ? null
    : {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ui: require('@expo/ui/jetpack-compose') as typeof Compose,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        modifiers: require('@expo/ui/jetpack-compose/modifiers') as typeof ComposeModifiers,
      };

export function ProgressIndicator(props: ProgressIndicatorProps): React.ReactElement {
  const native = toProgressIndicatorNativeProps(props, useThemeColors());
  const reduced = useReduceMotion();
  let body: React.ReactElement;
  if (reduced) body = <Icon concept="loader" size={24} tone="fg-2" />;
  else if (expoUi) {
    const Indicator = native.contained ? expoUi.ui.ContainedLoadingIndicator : expoUi.ui.LoadingIndicator;
    body = (
      <expoUi.ui.Host matchContents seedColor={native.seedColor}>
        <Indicator color={native.color} modifiers={[expoUi.modifiers.size(native.dp, native.dp)]} />
      </expoUi.ui.Host>
    );
  } else body = <ActivityIndicator size={native.dp === 64 ? 'large' : 'small'} color={native.color} />;
  return (
    <View testID={props.testID} accessible accessibilityRole="progressbar" accessibilityLabel={props.label} accessibilityState={{ busy: true }}>
      {body}
    </View>
  );
}

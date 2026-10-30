// MP-13 ProgressIndicator — iOS: SwiftUI ProgressView (circular) through Expo UI, sized by controlSize and tinted
// fg-2. A client without the ExpoUI module draws the UIKit ActivityIndicator.
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type * as SwiftUI from '@expo/ui/swift-ui';
import type * as SwiftUIModifiers from '@expo/ui/swift-ui/modifiers';

import { useThemeColors } from '../../lib/themeColors';
import type { ProgressIndicatorProps } from './ProgressIndicator.types';
import { toProgressIndicatorNativeProps } from './progressIndicatorModel';

export type { ProgressIndicatorProps } from './ProgressIndicator.types';

/** Expo UI, loaded only when this client has its native module (the barrel registers native views on import). */
const expoUi: { ui: typeof SwiftUI; modifiers: typeof SwiftUIModifiers } | null =
  requireOptionalNativeModule('ExpoUI') === null
    ? null
    : {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ui: require('@expo/ui/swift-ui') as typeof SwiftUI,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        modifiers: require('@expo/ui/swift-ui/modifiers') as typeof SwiftUIModifiers,
      };

export function ProgressIndicator(props: ProgressIndicatorProps): React.ReactElement {
  const native = toProgressIndicatorNativeProps(props, useThemeColors());
  return (
    <View testID={props.testID} accessible accessibilityRole="progressbar" accessibilityLabel={props.label} accessibilityState={{ busy: true }}>
      {expoUi ? (
        <expoUi.ui.Host matchContents>
          <expoUi.ui.ProgressView modifiers={[expoUi.modifiers.controlSize(native.controlSize), expoUi.modifiers.tint(native.color)]} />
        </expoUi.ui.Host>
      ) : (
        <ActivityIndicator size={native.controlSize === 'large' ? 'large' : 'small'} color={native.color} />
      )}
    </View>
  );
}

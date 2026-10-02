// MP-22 Switch — iOS: SwiftUI Toggle (switch style) through Expo UI, sized by its content, tinted with the accent
// (MD-48). No haptic call: the system plays its own. Falls back to the JS path without the ExpoUI module.
import React from 'react';
import { View } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import { swiftUI } from '../expoUi.ios';
import type { SwitchProps } from './Switch.types';
import { SwitchJs } from './SwitchJs';
import { toSwitchNativeProps } from './switchModel';

export type { SwitchProps } from './Switch.types';

export function Switch(props: SwitchProps): React.ReactElement {
  const native = toSwitchNativeProps(props, useThemeColors());
  if (!swiftUI) return <SwitchJs {...props} />;
  const { ui, modifiers: m } = swiftUI;
  return (
    <View testID={props.testID}>
      <ui.Host matchContents>
        <ui.Toggle
          isOn={native.isOn}
          onIsOnChange={props.onValueChange}
          label={props.label}
          modifiers={[m.toggleStyle('switch'), m.labelsHidden(), m.tint(native.onColor), m.disabled(!native.enabled), m.accessibilityLabel(props.label)]}
        />
      </ui.Host>
    </View>
  );
}

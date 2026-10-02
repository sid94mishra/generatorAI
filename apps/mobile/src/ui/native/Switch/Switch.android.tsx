// MP-22 Switch — Android: the M3 Compose Switch through Expo UI; checked track = accent, checked thumb = on-accent
// (MD-48). The RN wrapper is the accessibility element (Compose semantics cannot carry our label). Falls back to the
// JS path without the ExpoUI module. The ✓ thumb icon waits for Compose icon assets (MD-130).
import React from 'react';
import { View } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import { compose } from '../expoUi.android';
import type { SwitchProps } from './Switch.types';
import { SwitchJs } from './SwitchJs';
import { toSwitchNativeProps } from './switchModel';

export type { SwitchProps } from './Switch.types';

export function Switch(props: SwitchProps): React.ReactElement {
  const native = toSwitchNativeProps(props, useThemeColors());
  if (!compose) return <SwitchJs {...props} />;
  const { ui } = compose;
  return (
    <View
      testID={props.testID}
      accessible
      accessibilityRole="switch"
      accessibilityLabel={props.label}
      accessibilityState={{ checked: native.isOn, disabled: !native.enabled, busy: native.busy }}
      onAccessibilityTap={() => native.enabled && props.onValueChange(!native.isOn)}
    >
      <View importantForAccessibility="no-hide-descendants">
        <ui.Host matchContents>
          <ui.Switch value={native.isOn} enabled={native.enabled} onCheckedChange={props.onValueChange} colors={{ checkedTrackColor: native.onColor, checkedThumbColor: native.onThumb }} />
        </ui.Host>
      </View>
    </View>
  );
}

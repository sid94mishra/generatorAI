// MP-22 Switch — the JS path (Jest, the web preview, clients without Expo UI): RN's platform switch with our "on"
// colour (MD-48); off colours stay the system's.
import React from 'react';
import { Switch as RNSwitch, View } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import type { SwitchProps } from './Switch.types';
import { toSwitchNativeProps } from './switchModel';

export function SwitchJs(props: SwitchProps): React.ReactElement {
  const native = toSwitchNativeProps(props, useThemeColors());
  return (
    <View testID={props.testID}>
      <RNSwitch
        value={native.isOn}
        onValueChange={props.onValueChange}
        disabled={!native.enabled}
        trackColor={{ true: native.onColor }}
        thumbColor={native.isOn ? native.onThumb : undefined}
        accessibilityRole="switch"
        accessibilityLabel={props.label}
        accessibilityState={{ checked: native.isOn, disabled: !native.enabled, busy: native.busy }}
      />
    </View>
  );
}

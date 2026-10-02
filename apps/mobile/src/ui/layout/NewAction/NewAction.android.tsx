// ML-09 NewAction — Android (03 ML-09): the M3 Expressive Extended FAB (Expo UI, animated expand / collapse), h56,
// radius 16, accent container with the on-accent glyph (hosted kit Icon) and 14/600 label, 16 above the navigation
// bar inset. Without the ExpoUI module it is drawn in JS with the same geometry and shadow-float (MD-72).
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { useThemeColors } from '../../lib/themeColors';
import { compose } from '../../native/expoUi.android';
import { geometry } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { Icon } from '../../primitives/Icon';
import type { IconSize } from '../../primitives/Icon/Icon.types';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { NewActionProps } from './NewAction.types';

export type { NewActionProps } from './NewAction.types';

export function NewAction({ label, icon, onPress, collapsed = false, testID }: NewActionProps): React.ReactElement {
  const colors = useThemeColors();
  const insets = useInsets();
  const g = geometry().controls.newAction;
  const frame = { paddingEnd: g.endInset, paddingBottom: insets.bottom + g.bottomAboveSafeArea };
  if (compose) {
    const { ui } = compose;
    return (
      <View className="items-end" style={frame}>
        <View testID={testID} accessible accessibilityRole="button" accessibilityLabel={label} onAccessibilityTap={onPress}>
          <View importantForAccessibility="no-hide-descendants">
            <ui.Host matchContents>
              <ui.ExtendedFloatingActionButton expanded={!collapsed} containerColor={colors.accent} onClick={onPress}>
                <ui.ExtendedFloatingActionButton.Icon>
                  <ui.RNHostView matchContents>
                    <View>
                      <Icon concept={icon} size={g.icon as IconSize} tone="on-accent" />
                    </View>
                  </ui.RNHostView>
                </ui.ExtendedFloatingActionButton.Icon>
                <ui.ExtendedFloatingActionButton.Text>
                  <ui.Text color={colors.onAccent} maxLines={1} overflow="ellipsis">
                    {label}
                  </ui.Text>
                </ui.ExtendedFloatingActionButton.Text>
              </ui.ExtendedFloatingActionButton>
            </ui.Host>
          </View>
        </View>
      </View>
    );
  }
  return (
    <View className="items-end" style={frame}>
      <Pressable testID={testID} onPress={onPress} frame="none" feedback="scale" large accessibilityRole="button" accessibilityLabel={label} className="max-w-full">
        <View className={cn('min-h-new max-w-full flex-row items-center justify-center gap-3 rounded-new bg-accent shadow-float', collapsed ? 'w-14' : 'pe-5 ps-4')}>
          <Icon concept={icon} size={g.icon as IconSize} tone="on-accent" />
          {collapsed ? null : (
            <Text role="subhead" weight={600} tone="on-accent" numberOfLines={1} className="shrink">
              {label}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}

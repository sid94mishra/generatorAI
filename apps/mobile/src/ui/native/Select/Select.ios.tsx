// MP-24 Select — iOS: a SwiftUI Picker in the menu style (current value + ⇅, system menu) through Expo UI. `row`: the
// label at the start of a group row; `field`: the label above a sunken box. Falls back to the JS path without the
// ExpoUI module. Haptic: selection on change.
import React, { useState } from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { useThemeColors } from '../../lib/themeColors';
import { haptic } from '../../platform/haptics';
import { Text } from '../../primitives/Text';
import { swiftUI } from '../expoUi.ios';
import type { SelectProps } from './Select.types';
import { SelectJs } from './SelectJs';
import { selectAccessibilityLabel } from './selectModel';

export type { SelectOption, SelectProps } from './Select.types';

const NONE = '';

export function Select(props: SelectProps): React.ReactElement {
  const colors = useThemeColors();
  // The width the picker may use: the field's inner box, or 60 % of the row. SwiftUI's menu label tail-truncates in a
  // bounded frame; unbounded, a long value runs past the field (device review).
  const [room, setRoom] = useState(0);
  // The searchable list is a sheet (SelectJs); only the static menu is the SwiftUI Picker.
  if (!swiftUI || props.searchable) return <SelectJs {...props} />;
  const { ui, modifiers: m } = swiftUI;
  const { label, value, options, onValueChange, placeholder, presentation = 'row', disabled = false, testID } = props;
  const field = presentation === 'field';
  const bound = room > 0 ? [m.frame({ maxWidth: field ? room : Math.round(room * 0.6), alignment: field ? 'leading' : 'trailing' })] : [];
  const picker = (
    <ui.Host matchContents={field && room > 0 ? { vertical: true } : true} style={field && room > 0 ? { width: room } : undefined}>
      <ui.Picker
        selection={value ?? NONE}
        onSelectionChange={(v: string) => {
          if (v === NONE || v === value) return;
          haptic('selection');
          onValueChange(v);
        }}
        modifiers={[...bound, m.pickerStyle('menu'), m.labelsHidden(), m.tint(colors.fg3), m.disabled(disabled), m.accessibilityLabel(selectAccessibilityLabel(props)), m.accessibilityHint('Opens a menu')]}
      >
        {value === null ? <ui.Text modifiers={[m.tag(NONE)]}>{placeholder ?? 'None'}</ui.Text> : null}
        {options.map((o) => (
          <ui.Text key={o.value} modifiers={[m.tag(o.value), m.disabled(Boolean(o.disabled))]}>
            {o.label}
          </ui.Text>
        ))}
      </ui.Picker>
    </ui.Host>
  );
  if (presentation === 'field') {
    return (
      <View testID={testID} className="gap-1.5">
        <Text role="subhead" tone="fg-2" className="px-1">
          {label}
        </Text>
        <View className={cn('min-h-field flex-row items-center rounded-field bg-sunken px-1', disabled && 'opacity-60')}>
          <View className="flex-1" onLayout={(e) => setRoom(Math.floor(e.nativeEvent.layout.width))}>
            {picker}
          </View>
        </View>
      </View>
    );
  }
  return (
    <View testID={testID} onLayout={(e) => setRoom(Math.floor(e.nativeEvent.layout.width))} className={cn('min-h-field flex-row items-center gap-3 ps-4 pe-1', disabled && 'opacity-60')}>
      <View className="flex-1" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text role="body" numberOfLines={1}>
          {label}
        </Text>
      </View>
      {picker}
    </View>
  );
}

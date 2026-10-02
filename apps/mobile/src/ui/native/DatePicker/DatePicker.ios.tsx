// MP-26 DatePicker — iOS: a SwiftUI DatePicker through Expo UI (`.compact` in rows, `.wheel` in sheets), accent
// tint, range from minimumDate / maximumDate; minutes rounded to `minuteInterval`. Falls back to the JS path.
import React from 'react';
import { View } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import { swiftUI } from '../expoUi.ios';
import type { DatePickerProps } from './DatePicker.types';
import { DatePickerJs } from './DatePickerJs';
import { iosComponents, normalizeDate } from './datePickerModel';

export type { DatePickerMode, DatePickerProps } from './DatePicker.types';

export function DatePicker(props: DatePickerProps): React.ReactElement {
  const colors = useThemeColors();
  if (!swiftUI) return <DatePickerJs {...props} />;
  const { ui, modifiers: m } = swiftUI;
  const { mode, value, onValueChange, label, minimumDate, maximumDate, display = 'compact', testID } = props;
  return (
    <View testID={testID} className="self-start">
      <ui.Host matchContents>
        <ui.DatePicker
          title={label}
          selection={value}
          displayedComponents={iosComponents(mode)}
          range={{ start: minimumDate, end: maximumDate }}
          onDateChange={(d) => onValueChange(normalizeDate(d, props))}
          modifiers={[m.datePickerStyle(display), m.labelsHidden(), m.tint(colors.accent), m.accessibilityLabel(label)]}
        />
      </ui.Host>
    </View>
  );
}

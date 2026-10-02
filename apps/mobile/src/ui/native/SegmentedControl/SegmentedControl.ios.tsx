// MP-23 SegmentedControl — iOS: a SwiftUI segmented Picker (h32, system selection) through Expo UI. Counts, glyphs,
// locks and disabled segments take the drawn JS path; more than 4 segments, the large-text threshold or a row too
// narrow become a Select (MD-47). Without the ExpoUI module the JS path draws it. The system plays its own haptic.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { Select } from '../Select';
import { swiftUI } from '../expoUi.ios';
import type { SegmentedControlProps } from './SegmentedControl.types';
import { SegmentedControlJs } from './SegmentedControlJs';
import { useSegmentedPresentation } from './useSegmentedPresentation';

export type { Segment, SegmentedControlProps } from './SegmentedControl.types';

export function SegmentedControl<V extends string>(props: SegmentedControlProps<V>): React.ReactElement {
  const { segments, value, onValueChange, accessibilityLabel, fullWidth = false, testID } = props;
  const { presentation, width, onLayout } = useSegmentedPresentation(segments);
  let body: React.ReactElement;
  if (presentation === 'select') {
    body = (
      <Select
        label={accessibilityLabel}
        value={value}
        options={segments.map((s) => ({ value: s.value, label: s.count === undefined ? s.label : `${s.label} (${s.count})`, disabled: s.disabled || s.locked }))}
        onValueChange={(v) => onValueChange(v as V)}
        testID={testID}
      />
    );
  } else if (presentation === 'js' || !swiftUI) {
    body = <SegmentedControlJs {...props} />;
  } else {
    const { ui, modifiers: m } = swiftUI;
    body = (
      <View testID={testID} className="min-h-hit justify-center">
        <ui.Host matchContents={fullWidth ? { vertical: true } : true} style={fullWidth && width > 0 ? { width } : undefined}>
          <ui.Picker selection={value} onSelectionChange={(v: string) => v !== value && onValueChange(v as V)} modifiers={[m.pickerStyle('segmented'), m.accessibilityLabel(accessibilityLabel)]}>
            {segments.map((s) => (
              <ui.Text key={s.value} modifiers={[m.tag(s.value)]}>
                {s.label}
              </ui.Text>
            ))}
          </ui.Picker>
        </ui.Host>
      </View>
    );
  }
  return (
    <View onLayout={onLayout} className={cn('self-stretch', !fullWidth && presentation !== 'select' && 'items-start')}>
      {body}
    </View>
  );
}

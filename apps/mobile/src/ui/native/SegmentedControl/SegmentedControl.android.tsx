// MP-23 SegmentedControl — Android: the M3 SingleChoiceSegmentedButtonRow (h40, ✓ on the selected segment) through
// Expo UI, coloured from the kit tokens (MD-130). Counts, glyphs, locks and disabled segments take the drawn JS path;
// more than 4 segments, font scale ≥ 1.3 or a row too narrow become a Select (MD-47). Haptic: selection.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { useThemeColors } from '../../lib/themeColors';
import { haptic } from '../../platform/haptics';
import { Select } from '../Select';
import { compose } from '../expoUi.android';
import type { SegmentedControlProps } from './SegmentedControl.types';
import { SegmentedControlJs } from './SegmentedControlJs';
import { useSegmentedPresentation } from './useSegmentedPresentation';

export type { Segment, SegmentedControlProps } from './SegmentedControl.types';

export function SegmentedControl<V extends string>(props: SegmentedControlProps<V>): React.ReactElement {
  const colors = useThemeColors();
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
  } else if (presentation === 'js' || !compose) {
    body = <SegmentedControlJs {...props} />;
  } else {
    const { ui } = compose;
    const select = (v: V): void => {
      if (v === value) return;
      haptic('selection');
      onValueChange(v);
    };
    body = (
      <View testID={testID} className="min-h-hit justify-center">
        <ui.Host matchContents={fullWidth ? { vertical: true } : true} style={fullWidth && width > 0 ? { width } : undefined}>
          <ui.SingleChoiceSegmentedButtonRow>
            {segments.map((s) => (
              <ui.SegmentedButton
                key={s.value}
                selected={s.value === value}
                onClick={() => select(s.value)}
                colors={{
                  activeContainerColor: colors.selected,
                  activeContentColor: colors.fg,
                  inactiveContainerColor: colors.surface,
                  inactiveContentColor: colors.fg2,
                  activeBorderColor: colors.lineStrong,
                  inactiveBorderColor: colors.lineStrong,
                }}
              >
                <ui.SegmentedButton.Label>
                  <ui.Text>{s.label}</ui.Text>
                </ui.SegmentedButton.Label>
              </ui.SegmentedButton>
            ))}
          </ui.SingleChoiceSegmentedButtonRow>
        </ui.Host>
      </View>
    );
  }
  return (
    <View onLayout={onLayout} accessibilityLabel={presentation === 'native' ? accessibilityLabel : undefined} className={cn('self-stretch', !fullWidth && presentation !== 'select' && 'items-start')}>
      {body}
    </View>
  );
}

// MP-25 Slider — iOS: a SwiftUI Slider through Expo UI, accent-tinted, sized to the measured track width (the Host
// needs an explicit frame). Falls back to the JS path without the ExpoUI module.
import React, { useState } from 'react';
import { View } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import { swiftUI } from '../expoUi.ios';
import type { SliderProps } from './Slider.types';
import { SliderFrame, SliderJs } from './SliderJs';

export type { SliderProps } from './Slider.types';

export function Slider(props: SliderProps): React.ReactElement {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  if (!swiftUI) return <SliderJs {...props} />;
  const { ui, modifiers: m } = swiftUI;
  const { value, min, max, step, onSlidingComplete, disabled = false } = props;
  return (
    <SliderFrame
      props={props}
      track={(change) => (
        <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} className="min-h-hit justify-center">
          {width > 0 ? (
            <ui.Host style={{ width }} matchContents={{ vertical: true }}>
              <ui.Slider
                value={value}
                min={min}
                max={max}
                step={step}
                onValueChange={change}
                onEditingChanged={(editing) => !editing && onSlidingComplete?.(value)}
                modifiers={[m.tint(colors.accent), m.disabled(disabled)]}
              />
            </ui.Host>
          ) : null}
        </View>
      )}
    />
  );
}

// MP-25 Slider — Android: the M3 Compose Slider through Expo UI (bar thumb), accent thumb and active track, discrete
// stops for a stepped slider. Falls back to the JS path without the ExpoUI module.
import React, { useState } from 'react';
import { View } from 'react-native';

import { useThemeColors } from '../../lib/themeColors';
import { compose } from '../expoUi.android';
import type { SliderProps } from './Slider.types';
import { SliderFrame, SliderJs } from './SliderJs';
import { composeSteps } from './sliderModel';

export type { SliderProps } from './Slider.types';

export function Slider(props: SliderProps): React.ReactElement {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  if (!compose) return <SliderJs {...props} />;
  const { ui, modifiers: cm } = compose;
  const { value, min, max, step, onSlidingComplete, disabled = false } = props;
  return (
    <SliderFrame
      props={props}
      track={(change) => (
        <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} className="min-h-hit justify-center">
          {width > 0 ? (
            <ui.Host matchContents={{ vertical: true }} style={{ width }}>
              <ui.Slider
                value={value}
                min={min}
                max={max}
                steps={composeSteps(min, max, step)}
                enabled={!disabled}
                onValueChange={change}
                onValueChangeFinished={() => onSlidingComplete?.(value)}
                colors={{ thumbColor: colors.accent, activeTrackColor: colors.accent, inactiveTrackColor: colors.selected, activeTickColor: colors.onAccent, inactiveTickColor: colors.fg3 }}
                modifiers={[cm.fillMaxWidth()]}
              />
            </ui.Host>
          ) : null}
        </View>
      )}
    />
  );
}

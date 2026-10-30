// MP-01 Text — one component for every string (03 MP-01; mobile 02 §4.2). The role picks the vocabulary
// class (per-OS sizes from the Uniwind geometry blocks), the iOS Dynamic Type curve and the scale cap.
import React from 'react';
import { Text as RNText } from 'react-native';

import { cn } from '../../lib/cn';
import { geometry } from '../../platform/geometry';
import { effectiveScale, maxScaleFor, useFontScaleOverride } from '../../platform/fontScale';
import type { TextProps } from './Text.types';
import { ALIGN_CLASS, ROLE_CLASS, ROLE_STEP, TONE_CLASS, WEIGHT_CLASS, isHeadingRole, isMonoRole } from './textModel';

export type { TextProps, TextRole, TextTone } from './Text.types';

export function Text({
  role = 'body',
  tone = 'fg',
  weight,
  numberOfLines,
  ellipsizeMode,
  chrome = false,
  tabular,
  selectable = false,
  align = 'start',
  accessibilityRole,
  accessibilityLabel,
  className,
  testID,
  children,
}: TextProps): React.ReactElement {
  const step = ROLE_STEP[role];
  const ramp = geometry().type[step];
  const cap = maxScaleFor(step, chrome);
  const mono = isMonoRole(role);
  // Stories only: render at a simulated OS scale, honouring the role's cap.
  const simulated = useFontScaleOverride();
  const scaled = simulated === null ? undefined : effectiveScale(simulated, cap);
  return (
    <RNText
      testID={testID}
      accessibilityRole={accessibilityRole ?? (isHeadingRole(role) ? 'header' : undefined)}
      accessibilityLabel={accessibilityLabel}
      numberOfLines={numberOfLines}
      ellipsizeMode={ellipsizeMode}
      selectable={selectable}
      dynamicTypeRamp={ramp.ramp}
      maxFontSizeMultiplier={cap}
      className={cn(
        ROLE_CLASS[role],
        mono ? 'font-mono' : 'font-sans',
        TONE_CLASS[tone],
        weight !== undefined && WEIGHT_CLASS[weight],
        (tabular ?? mono) && 'tabular-nums',
        ALIGN_CLASS[align],
        className,
      )}
      style={scaled === undefined ? undefined : { fontSize: ramp.size * scaled, lineHeight: ramp.lineHeight * scaled }}
    >
      {children}
    </RNText>
  );
}

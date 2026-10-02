// MP-18 Textarea — Android (03 MP-18): the M3 outlined multi-line field, min height 96, the label floating onto the
// outline on focus or value (as MP-16). Focus = 2px accent, error = 2px err. Footer toolbar and meter below the text.
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { cn } from '../../lib/cn';
import { useThemeColors } from '../../lib/themeColors';
import { geometry } from '../../platform/geometry';
import { useMotion } from '../../platform/motion';
import { controlHint, useFieldContext } from '../Field/fieldContext';
import { floatingLabelGeometry, labelFloats } from '../Input/inputModel';
import { Text } from '../Text';
import type { TextareaProps } from './Textarea.types';
import { meterText, meterTone, rowBounds } from './textareaModel';

export type { TextareaMeter, TextareaProps } from './Textarea.types';

export function Textarea({
  label,
  value,
  onChangeText,
  placeholder,
  minRows,
  maxRows,
  mono = false,
  footer,
  meter,
  error,
  disabled = false,
  autoFocus,
  testID,
}: TextareaProps): React.ReactElement {
  const colors = useThemeColors();
  const field = useFieldContext();
  const toggle = useMotion('toggle');
  const [focused, setFocused] = useState(false);
  const floats = labelFloats(focused, value);
  const [labelHeight, setLabelHeight] = useState(16);
  const float = floatingLabelGeometry(labelHeight);
  const step = geometry().type[mono ? 'mono' : 'transcript'];
  const bounds = rowBounds(step.lineHeight, 32, minRows, maxRows);
  const outline = disabled ? 'border border-line px-4' : error ? 'border-2 border-err px-3.75' : focused ? 'border-2 border-accent px-3.75' : 'border border-line-strong px-4';
  return (
    <View className={cn('relative rounded-field', outline, disabled && 'opacity-60')} style={floats ? { paddingTop: float.padTop } : undefined}>
      <Animated.View
        pointerEvents="none"
        onLayout={(e) => floats && setLabelHeight(e.nativeEvent.layout.height)}
        layout={toggle.reduced ? undefined : LinearTransition.duration(150)}
        className={cn('absolute', floats ? 'start-3 bg-surface px-1' : 'start-4 top-4')}
        style={floats ? { top: float.top } : undefined}
      >
        <Text role={floats ? 'caption' : 'body'} tone={error ? 'err' : focused ? 'fg' : floats ? 'fg-2' : 'fg-3'} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
      <TextInput
        testID={testID}
        multiline
        value={value}
        onChangeText={onChangeText}
        placeholder={floats ? placeholder : undefined}
        placeholderTextColor={colors.fg3}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        editable={!disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        textAlignVertical="top"
        accessibilityLabel={label}
        accessibilityHint={controlHint({ error }, field)}
        accessibilityState={{ disabled }}
        style={{ minHeight: Math.max(bounds.minHeight, 96), maxHeight: bounds.maxHeight }}
        className={cn('py-4', mono ? 'font-mono text-mono' : 'font-sans text-transcript', 'text-fg')}
      />
      {footer || meter ? (
        <View className="min-h-control-sm flex-row items-center gap-2 pb-1">
          <View className="flex-1 flex-row items-center gap-1">{footer}</View>
          {meter ? (
            <Text role="monoSm" tone={meterTone(meter)} chrome>
              {meterText(meter)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

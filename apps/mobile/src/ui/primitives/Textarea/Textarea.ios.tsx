// MP-18 Textarea — iOS (03 MP-18): multi-line text in the transcript role (16 / 24). `row`: inside a group, padding
// 12 16, min height 92. `standalone`: the label above a raised box with radius 16; focus = 1px fg-3, error = 1px err.
// Grows from minRows to maxRows, then scrolls. Optional inline footer toolbar and size meter.
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';

import { cn } from '../../lib/cn';
import { useThemeColors } from '../../lib/themeColors';
import { geometry } from '../../platform/geometry';
import { controlHint, useFieldContext } from '../Field/fieldContext';
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
  presentation = 'standalone',
  footer,
  meter,
  error,
  disabled = false,
  autoFocus,
  testID,
}: TextareaProps): React.ReactElement {
  const colors = useThemeColors();
  const field = useFieldContext();
  const [focused, setFocused] = useState(false);
  const step = geometry().type[mono ? 'mono' : 'transcript'];
  const bounds = rowBounds(step.lineHeight, 24, minRows, maxRows);
  const row = presentation === 'row';
  return (
    <View className="gap-1.5">
      {row ? null : (
        <Text role="subhead" tone="fg-2" className="px-1">
          {label}
        </Text>
      )}
      <View
        className={cn(
          row ? 'px-4' : 'rounded-control-sm border bg-raised px-4',
          !row && (error ? 'border-err' : focused ? 'border-fg-3' : 'border-transparent'),
          disabled && 'opacity-60',
        )}
      >
        <TextInput
          testID={testID}
          multiline
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.fg3}
          selectionColor={colors.accent}
          editable={!disabled}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          textAlignVertical="top"
          accessibilityLabel={label}
          accessibilityHint={controlHint({ error }, field)}
          accessibilityState={{ disabled }}
          style={row ? { minHeight: Math.max(bounds.minHeight, 92), maxHeight: bounds.maxHeight } : bounds}
          className={cn('py-3', mono ? 'font-mono text-mono' : 'font-sans text-transcript', 'text-fg')}
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
    </View>
  );
}

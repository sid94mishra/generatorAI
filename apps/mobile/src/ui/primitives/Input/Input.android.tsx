// MP-16 Input — Android (03 MP-16): the M3 outlined field. h56, rounded-field 4, 1px line-strong; the label rests in
// the field and floats onto the outline (12) on focus or value; focus = 2px accent (ink accent = fg), error = 2px err.
// `presentation` is iOS-only (M3 has one field style per form).
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { cn } from '../../lib/cn';
import { useThemeColors } from '../../lib/themeColors';
import { useMotion } from '../../platform/motion';
import { useFieldContext, controlHint } from '../Field/fieldContext';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { Text } from '../Text';
import type { InputProps } from './Input.types';
import { frameState, kindProps, labelFloats, spokenValue } from './inputModel';

export type { InputKind, InputProps } from './Input.types';

/** The outline per state; the 2px states trim the padding by 1 so the text never shifts. */
const OUTLINE = {
  idle: 'border border-line-strong px-4',
  disabled: 'border border-line px-4',
  focused: 'border-2 border-accent px-3.75',
  error: 'border-2 border-err px-3.75',
} as const;

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  kind = 'text',
  leadingIcon,
  trailing,
  error,
  disabled = false,
  readOnly = false,
  autoFocus,
  returnKeyType,
  onSubmitEditing,
  onFocus,
  onBlur,
  textContentType,
  autoComplete,
  maxLength,
  testID,
}: InputProps): React.ReactElement {
  const colors = useThemeColors();
  const field = useFieldContext();
  const toggle = useMotion('toggle');
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const k = kindProps(kind);
  const state = frameState({ focused, error, disabled });
  const floats = labelFloats(focused, value);

  return (
    <View className={cn('relative min-h-field flex-row items-center gap-3 rounded-field', OUTLINE[state], disabled && 'opacity-60')}>
      <Animated.View
        pointerEvents="none"
        layout={toggle.reduced ? undefined : LinearTransition.duration(150)}
        className={cn('absolute', floats ? '-top-2.5 start-3 bg-surface px-1' : 'inset-y-0 justify-center', !floats && (leadingIcon ? 'start-13' : 'start-4'))}
      >
        <Text role={floats ? 'caption' : 'body'} tone={error ? 'err' : floats && !focused ? 'fg-2' : focused ? 'fg' : 'fg-3'} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
      {leadingIcon ? <Icon concept={leadingIcon} size={24} tone="fg-2" /> : null}
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={floats ? placeholder : undefined}
        placeholderTextColor={colors.fg3}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        editable={!disabled && !readOnly}
        readOnly={readOnly}
        autoFocus={autoFocus}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        secureTextEntry={k.secure && !revealed}
        keyboardType={k.keyboardType}
        autoCapitalize={k.autoCapitalize}
        autoCorrect={k.autoCorrect}
        textContentType={textContentType ?? k.textContentType}
        autoComplete={autoComplete ?? k.autoComplete}
        maxLength={maxLength}
        accessibilityLabel={label}
        accessibilityHint={controlHint({ error }, field)}
        accessibilityValue={{ text: spokenValue(kind, value, revealed) }}
        accessibilityState={{ disabled }}
        className={cn('min-h-field flex-1 py-0', k.mono ? 'font-mono text-mono-lg' : 'font-sans text-body', disabled ? 'text-fg-3' : 'text-fg')}
      />
      {trailing}
      {k.secure ? (
        <Pressable
          onPress={() => setRevealed((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={revealed ? `Hide ${label}` : `Show ${label}`}
          feedback="none"
          borderless
          className="-me-3"
        >
          <Icon concept={revealed ? 'hide' : 'view'} size={24} tone="fg-2" />
        </Pressable>
      ) : null}
    </View>
  );
}

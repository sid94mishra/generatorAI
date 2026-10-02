// MP-16 Input — iOS (03 MP-16). `row`: inside a ListSection group, a 96-wide body label column + the value, no
// border (the group is the container), native clear button while editing. `standalone`: the label above a
// rounded-field sunken box; focus draws a 1px fg-3 ring, an error a 1px err ring.
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';

import { cn } from '../../lib/cn';
import { useThemeColors } from '../../lib/themeColors';
import { useFieldContext, controlHint } from '../Field/fieldContext';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { Text } from '../Text';
import type { InputProps } from './Input.types';
import { frameState, kindProps, spokenValue } from './inputModel';

export type { InputKind, InputProps } from './Input.types';

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  presentation = 'row',
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
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const k = kindProps(kind);
  const state = frameState({ focused, error, disabled });
  const row = presentation === 'row';

  const input = (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.fg3}
      selectionColor={colors.accent}
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
      clearButtonMode={row && !k.secure && !readOnly ? 'while-editing' : 'never'}
      accessibilityLabel={label}
      accessibilityHint={controlHint({ error }, field)}
      accessibilityValue={{ text: spokenValue(kind, value, revealed) }}
      accessibilityState={{ disabled }}
      className={cn('min-h-field flex-1 py-0', k.mono ? 'font-mono text-mono-lg' : 'font-sans text-body', disabled ? 'text-fg-3' : 'text-fg')}
    />
  );

  const accessories = (
    <>
      {trailing}
      {error && row ? <Icon concept="status-failed" size={16} tone="err" /> : null}
      {k.secure ? (
        <Pressable
          onPress={() => setRevealed((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={revealed ? `Hide ${label}` : `Show ${label}`}
          feedback="none"
        >
          <Icon concept={revealed ? 'hide' : 'view'} size={18} tone="fg-3" />
        </Pressable>
      ) : null}
    </>
  );

  if (row) {
    return (
      <View className={cn('min-h-field flex-row items-center gap-3 px-4', disabled && 'opacity-60')}>
        {leadingIcon ? <Icon concept={leadingIcon} tone="fg-2" /> : null}
        <Text role="body" tone={error ? 'err' : 'fg'} numberOfLines={1} className="w-24">
          {label}
        </Text>
        {input}
        {accessories}
      </View>
    );
  }
  return (
    <View className="gap-1.5">
      <Text role="subhead" tone="fg-2" className="px-1">
        {label}
      </Text>
      <View
        className={cn(
          'min-h-field flex-row items-center gap-2 rounded-field border bg-sunken pe-1 ps-3',
          state === 'error' ? 'border-err' : state === 'focused' ? 'border-fg-3' : 'border-transparent',
          disabled && 'opacity-60',
        )}
      >
        {leadingIcon ? <Icon concept={leadingIcon} size={18} tone="fg-3" /> : null}
        {input}
        {accessories}
      </View>
    </View>
  );
}

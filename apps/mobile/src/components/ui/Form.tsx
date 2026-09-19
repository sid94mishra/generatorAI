// ────────────────────────────────────────────────────────────────
// Form controls — themed switch, text field and search field.
//
// RN's `Switch` takes explicit colour props rather than styles, so it cannot
// pick up NativeWind classes and has to be fed from the theme directly.
//
// `Field` links its label to its input with `nativeID` + `accessibilityLabelledBy`.
// Without that the label is a separate, unrelated text node and the input
// announces as "text field" with no idea what it is for — the mobile
// equivalent of an unlabelled `<input>`.
// ────────────────────────────────────────────────────────────────

import React, { useId, useRef, useState } from 'react';
import { Switch as RNSwitch, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Search, X } from 'lucide-react-native';

import { Touchable } from './Touchable';
import { MAX_SCALE, MIN_TARGET } from './accessibility';
import { haptics } from './haptics';
import { useTheme } from '../../theme/ThemeProvider';

export function Switch({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <RNSwitch
      accessibilityLabel={accessibilityLabel ?? ''}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        haptics.select();
        onValueChange(next);
      }}
      // Off track on `input` (the form-control border token), not `emphasis`:
      // on a card, an `emphasis` track with a `background` thumb was a dark
      // shape on a dark surface and every OFF switch was near-invisible.
      trackColor={{ false: colors.input ?? colors.border ?? '', true: colors.primary ?? '' }}
      thumbColor="#ffffff"
      ios_backgroundColor={colors.input ?? colors.border}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  ...rest
}: TextInputProps & {
  label?: string;
  hint?: string;
  error?: string | null;
}): React.ReactElement {
  const { colors } = useTheme();
  const labelId = useId();

  return (
    <View className="gap-1.5">
      {label ? (
        <Text nativeID={labelId} className="text-sm font-medium text-foreground">
          {label}
        </Text>
      ) : null}
      <TextInput
        {...(label ? { accessibilityLabelledBy: labelId, accessibilityLabel: label } : {})}
        style={{ minHeight: MIN_TARGET }}
        accessibilityState={{ disabled: rest.editable === false }}
        placeholderTextColor={colors['muted-foreground']}
        className={`min-h-11 rounded-2xl border bg-raised px-3 py-2.5 text-md text-foreground ${
          error ? 'border-danger' : 'border-border'
        }`}
        {...rest}
      />
      {error ? (
        // Assertive: a validation failure that appears while the user is
        // still typing is worth interrupting for.
        <Text accessibilityLiveRegion="assertive" className="text-xs text-danger">
          {error}
        </Text>
      ) : hint ? (
        <Text className="text-xs text-muted-foreground">{hint}</Text>
      ) : null}
    </View>
  );
}

/**
 * The list search field.
 *
 * A dedicated component rather than a `Field` with an icon, because search
 * carries platform behaviour a generic field must not: the search return key,
 * a clear button, no autocorrect, and cancellation without submitting.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  autoFocus = false,
  onSubmit,
  onFocus,
  onBlur,
  onCancel,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /**
   * Renders a Cancel affordance while focused (the iOS search-bar
   * convention): clears the query, blurs the field, then calls this.
   */
  onCancel?: () => void;
  accessibilityLabel?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  return (
    <View className="flex-row items-center gap-2">
      <View
        className={`min-h-11 flex-1 flex-row items-center gap-2 rounded-2xl border bg-raised px-3 ${
          focused ? 'border-primary' : 'border-border'
        }`}
      >
        <Search size={16} color={colors['muted-foreground']} />
        <TextInput
          ref={input}
          accessibilityLabel={accessibilityLabel ?? placeholder}
          accessibilityRole="search"
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors['muted-foreground']}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          returnKeyType="search"
          clearButtonMode="never"
          onSubmitEditing={onSubmit}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          className="flex-1 py-2.5 text-md text-foreground"
        />
        {value.length > 0 ? (
          <Touchable
            accessibilityLabel="Clear search"
            haptic="select"
            scale="none"
            ripple={false}
            onPress={() => onChangeText('')}
          >
            <X size={16} color={colors['muted-foreground']} />
          </Touchable>
        ) : null}
      </View>
      {onCancel && focused ? (
        <Touchable
          accessibilityLabel="Cancel search"
          haptic="select"
          ripple={false}
          scale="none"
          onPress={() => {
            onChangeText('');
            input.current?.blur();
            onCancel();
          }}
          className="min-h-11 justify-center px-1"
        >
          <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-md text-primary">
            Cancel
          </Text>
        </Touchable>
      ) : null}
    </View>
  );
}

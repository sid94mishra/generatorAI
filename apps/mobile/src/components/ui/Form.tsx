// ────────────────────────────────────────────────────────────────
// Form controls — themed switch and text field.
//
// RN's `Switch` takes explicit colour props rather than styles, so it cannot
// pick up NativeWind classes and has to be fed from the theme directly.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Switch as RNSwitch, Text, TextInput, View, type TextInputProps } from 'react-native';

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
      trackColor={{ false: colors.emphasis ?? '', true: colors.primary ?? '' }}
      thumbColor={colors.background}
      ios_backgroundColor={colors.emphasis}
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
  return (
    <View className="gap-1.5">
      {label ? <Text className="text-sm font-medium text-foreground">{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors['muted-foreground']}
        className={`min-h-11 rounded-2xl border bg-raised px-3 py-2.5 text-md text-foreground ${
          error ? 'border-danger' : 'border-border'
        }`}
        {...rest}
      />
      {error ? (
        <Text className="text-xs text-danger">{error}</Text>
      ) : hint ? (
        <Text className="text-xs text-muted-foreground">{hint}</Text>
      ) : null}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// Buttons.
//
// Three components rather than one with a dozen props, because the shapes
// genuinely differ: `Button` is a labelled bar, `IconButton` is a circular
// 44pt target, `Fab` floats above content with a shadow.
//
// All heights are >= 44pt (HIG minimum). The `sm` variant is 36pt tall but
// keeps a 44pt target via `Touchable`'s hitSlop.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Touchable, type HapticIntent } from './Touchable';
import { useTheme } from '../../theme/ThemeProvider';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CONTAINER: Record<ButtonVariant, string> = {
  primary: 'bg-primary',
  secondary: 'bg-raised border border-border',
  ghost: 'bg-transparent',
  danger: 'bg-danger',
};

const VARIANT_LABEL: Record<ButtonVariant, string> = {
  primary: 'text-primary-foreground',
  secondary: 'text-foreground',
  ghost: 'text-primary',
  danger: 'text-destructive-foreground',
};

const SIZE_CONTAINER: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 rounded-2xl',
  md: 'h-11 px-4 rounded-2xl',
  lg: 'h-12 px-5 rounded-3xl',
};

const SIZE_LABEL: Record<ButtonSize, string> = {
  sm: 'text-sm',
  md: 'text-md',
  lg: 'text-lg',
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  full = false,
  haptic = 'commit',
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  haptic?: HapticIntent;
  accessibilityLabel?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  const spinnerColor =
    variant === 'primary'
      ? colors['primary-foreground']
      : variant === 'danger'
        ? colors['destructive-foreground']
        : colors.foreground;

  return (
    <Touchable
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled || loading}
      haptic={haptic}
      onPress={onPress}
      className={`flex-row items-center justify-center gap-2 ${SIZE_CONTAINER[size]} ${VARIANT_CONTAINER[variant]} ${full ? 'w-full' : 'self-start'}`}
    >
      {loading ? <ActivityIndicator size="small" color={spinnerColor} /> : icon}
      <Text className={`font-semibold ${SIZE_LABEL[size]} ${VARIANT_LABEL[variant]}`}>{label}</Text>
    </Touchable>
  );
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'ghost',
  disabled = false,
  badge = false,
  haptic = 'tap',
}: {
  icon: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Draws an accent dot in the corner — unread / active state. */
  badge?: boolean;
  haptic?: HapticIntent;
}): React.ReactElement {
  return (
    <Touchable
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      haptic={haptic}
      onPress={onPress}
      className={`h-11 w-11 items-center justify-center rounded-full ${VARIANT_CONTAINER[variant]}`}
    >
      {icon}
      {badge ? (
        <View className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-background bg-primary" />
      ) : null}
    </Touchable>
  );
}

/**
 * Floating action button.
 *
 * Sits above the tab bar and clear of the home indicator; callers pass the
 * bottom offset because only the screen knows whether a tab bar is present.
 */
export function Fab({
  icon,
  label,
  onPress,
  accessibilityLabel,
  bottom = 24,
}: {
  icon: React.ReactNode;
  label?: string;
  onPress: () => void;
  accessibilityLabel: string;
  bottom?: number;
}): React.ReactElement {
  return (
    <View className="absolute right-4" style={{ bottom }} pointerEvents="box-none">
      <Touchable
        accessibilityLabel={accessibilityLabel}
        haptic="commit"
        onPress={onPress}
        scale="default"
        className={`h-14 flex-row items-center justify-center gap-2 rounded-full bg-primary ${label ? 'px-5' : 'w-14'}`}
        style={{
          shadowColor: '#000',
          shadowOpacity: 0.28,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        {icon}
        {label ? (
          <Text className="text-md font-semibold text-primary-foreground">{label}</Text>
        ) : null}
      </Touchable>
    </View>
  );
}

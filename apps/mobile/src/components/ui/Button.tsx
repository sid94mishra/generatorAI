// ────────────────────────────────────────────────────────────────
// Buttons.
//
// Three components rather than one with a dozen props, because the shapes
// genuinely differ: `Button` is a labelled bar, `IconButton` is a circular
// platform-minimum target, `Fab` floats above content with a shadow.
//
// Heights are MINIMUMS, not fixed values. A fixed `h-11` clips its own label
// the moment the user raises their reading size, which is the most common
// accessibility setting on both platforms; `min-h-11` plus vertical padding
// grows instead.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Touchable, type HapticIntent } from './Touchable';
import { MAX_SCALE, MIN_TARGET, useFontScale } from './accessibility';
import { useTheme } from '../../theme/ThemeProvider';
import { useTabShell } from '../../navigation/tabShell';

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
  sm: 'min-h-9 px-3 py-1.5 rounded-2xl',
  md: 'min-h-11 px-4 py-2.5 rounded-2xl',
  lg: 'min-h-12 px-5 py-3 rounded-3xl',
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
  grow = false,
  haptic = 'commit',
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  /** Fill the parent's width (column layouts). */
  full?: boolean;
  /**
   * Share a `flex-row` with sibling buttons. `full` alone makes each button
   * 100 % wide inside a row, so the second one is pushed off-screen — seen
   * on the permission card and the Home decision card in the Sept 7 run.
   */
  grow?: boolean;
  haptic?: HapticIntent;
  accessibilityLabel?: string;
  accessibilityHint?: string;
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
      {...(accessibilityHint ? { accessibilityHint } : {})}
      // `busy` is what tells a screen reader that the pending action was
      // registered — otherwise a loading button is just an unresponsive one.
      accessibilityState={{ busy: loading }}
      disabled={disabled || loading}
      haptic={haptic}
      onPress={onPress}
      className={`flex-row items-center justify-center gap-2 ${SIZE_CONTAINER[size]} ${VARIANT_CONTAINER[variant]} ${grow ? 'flex-1' : full ? 'w-full' : 'self-start'}`}
    >
      {loading ? <ActivityIndicator size="small" color={spinnerColor} /> : icon}
      <Text
        maxFontSizeMultiplier={MAX_SCALE.control}
        className={`font-semibold ${SIZE_LABEL[size]} ${VARIANT_LABEL[variant]}`}
      >
        {label}
      </Text>
    </Touchable>
  );
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  variant = 'ghost',
  compact = false,
  disabled = false,
  badge = false,
  selected,
  haptic = 'tap',
  testID,
}: {
  icon: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  variant?: ButtonVariant;
  /**
   * Shrinks the drawn box for dense toolbars. The TAP target stays at the
   * 44pt minimum via hitSlop — only the ink gets smaller.
   */
  compact?: boolean;
  disabled?: boolean;
  /** Draws an accent dot in the corner — unread / active state. */
  badge?: boolean;
  /** Toggle buttons pass this so the state is announced, not just drawn. */
  selected?: boolean;
  haptic?: HapticIntent;
  /** For E2E: an icon-only control has no text for a test to find. */
  testID?: string;
}): React.ReactElement {
  const box = compact ? 32 : MIN_TARGET;
  const slop = Math.max(0, Math.round((MIN_TARGET - box) / 2));

  return (
    <Touchable
      accessibilityLabel={accessibilityLabel}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      {...(selected === undefined ? {} : { accessibilityState: { selected } })}
      {...(testID ? { testID } : {})}
      disabled={disabled}
      haptic={haptic}
      onPress={onPress}
      {...(slop > 0 ? { hitSlop: { top: slop, bottom: slop, left: slop, right: slop } } : {})}
      style={{ width: box, height: box }}
      className={`items-center justify-center rounded-full ${VARIANT_CONTAINER[variant]}`}
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
 * Positions itself above the home indicator without being told: the caller
 * only knows whether a tab bar is present, not how tall the inset is, and
 * the previous fixed `bottom={24}` put it inside the HIG clearance on every
 * gesture-navigation device.
 */
export function Fab({
  icon,
  label,
  onPress,
  accessibilityLabel,
  /**
   * Clearance above the safe area. Ignored inside the tab shell, where the
   * shell knows the bar's real height (`useTabShell().fabBottom`).
   */
  offset = 16,
}: {
  icon: React.ReactNode;
  label?: string;
  onPress: () => void;
  accessibilityLabel: string;
  offset?: number;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const fontScale = useFontScale();
  const shell = useTabShell();
  const bottom = shell ? shell.fabBottom : insets.bottom + offset;

  return (
    <View className="absolute right-4" style={{ bottom }} pointerEvents="box-none">
      <Touchable
        accessibilityLabel={accessibilityLabel}
        // Opening a creation sheet is navigation, not a decision.
        haptic="tap"
        onPress={onPress}
        scale="default"
        className={`flex-row items-center justify-center gap-2 rounded-full bg-primary ${label ? 'px-5' : ''}`}
        style={{
          minHeight: 56,
          ...(label ? {} : { width: 56 }),
          // D32: an alpha in `shadowColor` multiplies with `shadowOpacity`,
          // so the previous `rgba(0,0,0,0.9)` shipped a 25% shadow while
          // reading as 28%. Opaque colour, one opacity.
          shadowColor: 'rgb(0,0,0)',
          shadowOpacity: 0.28,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        {icon}
        {/* The label is dropped rather than truncated at large reading sizes:
            a FAB that grows to half the screen width is worse than an icon. */}
        {label && fontScale <= 1.35 ? (
          <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-md font-semibold text-primary-foreground">
            {label}
          </Text>
        ) : null}
      </Touchable>
    </View>
  );
}

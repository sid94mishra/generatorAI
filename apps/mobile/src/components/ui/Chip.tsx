// ────────────────────────────────────────────────────────────────
// Chip — the composer's control vocabulary.
//
// A chip is a *stateful* control that shows its current value, unlike a
// button which shows an action. The composer needs six of these and a phone
// is 393pt wide, so the value text truncates rather than wrapping.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';

import { Touchable } from './Touchable';
import { useTheme } from '../../theme/ThemeProvider';

export function Chip({
  label,
  icon,
  onPress,
  active = false,
  disabled = false,
  showChevron = false,
  accessibilityLabel,
  maxWidth,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  /** Filled treatment — the value differs from the default. */
  active?: boolean;
  disabled?: boolean;
  showChevron?: boolean;
  accessibilityLabel?: string;
  maxWidth?: number;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touchable
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      haptic="select"
      onPress={onPress}
      className={`h-8 flex-row items-center gap-1.5 rounded-full border px-2.5 ${
        active ? 'border-primary bg-accent' : 'border-border bg-raised'
      }`}
      style={maxWidth ? { maxWidth } : undefined}
    >
      {icon}
      <Text
        numberOfLines={1}
        className={`text-sm font-medium ${active ? 'text-primary' : 'text-muted-foreground'}`}
      >
        {label}
      </Text>
      {showChevron ? (
        <ChevronDown size={12} color={active ? colors.primary : colors['muted-foreground']} />
      ) : null}
    </Touchable>
  );
}

/** A non-interactive chip — read-only metadata in a header or footer. */
export function StaticChip({
  label,
  icon,
  mono = false,
}: {
  label: string;
  icon?: React.ReactNode;
  mono?: boolean;
}): React.ReactElement {
  return (
    <View className="h-7 flex-row items-center gap-1.5 self-start rounded-full bg-subtle px-2.5">
      {icon}
      <Text
        numberOfLines={1}
        className={`text-xs text-muted-foreground ${mono ? 'font-mono' : ''}`}
      >
        {label}
      </Text>
    </View>
  );
}

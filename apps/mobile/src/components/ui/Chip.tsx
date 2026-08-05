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
import { MAX_SCALE } from './accessibility';
import { useTheme } from '../../theme/ThemeProvider';

export function Chip({
  label,
  icon,
  onPress,
  active = false,
  disabled = false,
  showChevron = false,
  accessibilityLabel,
  accessibilityHint,
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
  accessibilityHint?: string;
  maxWidth?: number;
}): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Touchable
      accessibilityLabel={accessibilityLabel ?? label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      // A chip is a value, not a command: `active` has to be announced or the
      // only signal that the model picker is set is a border colour.
      accessibilityState={{ selected: active }}
      disabled={disabled}
      haptic="select"
      onPress={onPress}
      className={`min-h-8 flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${
        active ? 'border-primary bg-accent' : 'border-border bg-raised'
      }`}
      style={maxWidth ? { maxWidth } : undefined}
    >
      {icon}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_SCALE.chrome}
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
    <View className="min-h-7 flex-row items-center gap-1.5 self-start rounded-full bg-subtle px-2.5 py-0.5">
      {icon}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_SCALE.chrome}
        className={`text-xs text-muted-foreground ${mono ? 'font-mono' : ''}`}
      >
        {label}
      </Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// Chip — a compact, stateful control that shows its current value.
//
// Unlike a button (which shows an action) a chip shows a VALUE: the model
// picker reads "Sonnet", a filter reads "Running", a tag reads "#infra".
// The composer needs six of these on a 393pt screen, so the label
// truncates rather than wrapping.
//
// One component covers the three shapes the app was drifting toward:
//   • a picker chip  — `onPress` + `showChevron`, `selected` when non-default
//   • a filter chip  — `selected` toggles, `tone` colours the selection
//   • a token chip   — `onRemove` renders a clear button (attachments, tags)
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { ChevronDown, X } from 'lucide-react-native';

import { Touchable } from './Touchable';
import { MAX_SCALE, MIN_TARGET } from './accessibility';
import { useTheme } from '../../theme/ThemeProvider';

export type ChipTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
export type ChipSize = 'sm' | 'md';

// Opacity modifiers (`bg-primary/15`) are avoided: the palette is delivered
// as bare `var(--x)` strings, which Tailwind cannot decompose, so every tone
// uses a real `-muted` token. Resting chips are tone-agnostic — colour only
// appears once the chip is selected, which is the "quiet chrome" rule.
const SELECTED_CONTAINER: Record<ChipTone, string> = {
  neutral: 'border-emphasis bg-emphasis',
  accent: 'border-primary bg-accent',
  success: 'border-success bg-success-muted',
  warning: 'border-warning bg-warning-muted',
  danger: 'border-danger bg-danger-muted',
};

const SELECTED_TEXT: Record<ChipTone, string> = {
  neutral: 'text-foreground',
  accent: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

const SIZE_CONTAINER: Record<ChipSize, string> = {
  sm: 'min-h-7 px-2 py-0.5 gap-1',
  md: 'min-h-8 px-2.5 py-1 gap-1.5',
};

const SIZE_TEXT: Record<ChipSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
};

export interface ChipProps {
  label: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  /**
   * Filled treatment — the value differs from the default, or the filter is
   * on. `selected` is the v2 name; `active` remains as an alias.
   */
  selected?: boolean;
  /** @deprecated Use `selected`. Kept so existing call sites keep working. */
  active?: boolean;
  /** Colour of the selected state. Resting chips are always neutral. */
  tone?: ChipTone;
  size?: ChipSize;
  disabled?: boolean;
  showChevron?: boolean;
  /** Renders a trailing clear button and makes the chip a removable token. */
  onRemove?: () => void;
  /** Label for the clear button; defaults to "Remove <label>". */
  removeLabel?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  maxWidth?: number;
}

export function Chip({
  label,
  icon,
  onPress,
  selected,
  active = false,
  tone = 'accent',
  size = 'md',
  disabled = false,
  showChevron = false,
  onRemove,
  removeLabel,
  accessibilityLabel,
  accessibilityHint,
  maxWidth,
}: ChipProps): React.ReactElement {
  const { colors } = useTheme();
  const isSelected = selected ?? active;

  const container = isSelected ? SELECTED_CONTAINER[tone] : 'border-border bg-raised';
  const text = isSelected ? SELECTED_TEXT[tone] : 'text-muted-foreground';
  const iconColor = isSelected
    ? tone === 'accent'
      ? colors.primary
      : tone === 'neutral'
        ? colors.foreground
        : colors[tone]
    : colors['muted-foreground'];

  // An empty label is a deliberate icon-only chip: the caller keeps the
  // accessible name and drops the visible one when the value is the default
  // and the strip needs the room. Rendering an empty <Text> instead would
  // leave its gap behind and the chip would look lopsided.
  const iconOnly = label.length === 0;

  const body = (
    <>
      {icon}
      {iconOnly ? null : (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCALE.chrome}
          className={`font-medium ${SIZE_TEXT[size]} ${text}`}
        >
          {label}
        </Text>
      )}
      {showChevron && !iconOnly ? (
        <ChevronDown size={size === 'sm' ? 11 : 12} color={iconColor} />
      ) : null}
    </>
  );

  // A removable chip is TWO controls — the chip and its clear button — so the
  // clear button is a sibling, not a child, of the pressable: nested
  // pressables leave the inner one unreachable to a screen reader.
  if (onRemove) {
    return (
      <View
        className={`flex-row items-center self-start overflow-hidden rounded-full border ${container}`}
        style={maxWidth ? { maxWidth } : undefined}
      >
        <Touchable
          accessibilityLabel={accessibilityLabel ?? label}
          {...(accessibilityHint ? { accessibilityHint } : {})}
          accessibilityState={{ selected: isSelected }}
          disabled={disabled || !onPress}
          haptic="select"
          ripple={false}
          scale="none"
          onPress={onPress}
          style={{ minHeight: MIN_TARGET, minWidth: onPress ? MIN_TARGET : undefined }}
          className={`flex-1 flex-row items-center ${SIZE_CONTAINER[size]} pr-0`}
        >
          {body}
        </Touchable>
        <Touchable
          accessibilityLabel={removeLabel ?? `Remove ${label}`}
          disabled={disabled}
          haptic="select"
          ripple={false}
          scale="none"
          onPress={onRemove}
          style={{ minHeight: MIN_TARGET, minWidth: MIN_TARGET }}
          className={`items-center justify-center ${size === 'sm' ? 'px-1.5' : 'px-2'} self-stretch`}
        >
          <X size={size === 'sm' ? 12 : 14} color={iconColor} />
        </Touchable>
      </View>
    );
  }

  return (
    <Touchable
      accessibilityLabel={accessibilityLabel ?? label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      // A chip is a value, not a command: `selected` has to be announced or
      // the only signal that the model picker is set is a border colour.
      accessibilityState={{ selected: isSelected }}
      disabled={disabled}
      haptic="select"
      onPress={onPress}
      className={`flex-row items-center rounded-full border ${SIZE_CONTAINER[size]} ${iconOnly ? 'justify-center px-2' : ''} ${container}`}
      style={{ ...(maxWidth ? { maxWidth } : {}), ...(onPress ? { minHeight: MIN_TARGET, minWidth: MIN_TARGET } : {}) }}
    >
      {body}
    </Touchable>
  );
}

/** A non-interactive chip — read-only metadata in a header or footer. */
export function StaticChip({
  label,
  icon,
  mono = false,
  tone = 'neutral',
  size = 'md',
}: {
  label: string;
  icon?: React.ReactNode;
  mono?: boolean;
  tone?: ChipTone;
  size?: ChipSize;
}): React.ReactElement {
  const container = tone === 'neutral' ? 'bg-subtle' : SELECTED_CONTAINER[tone];
  const text = tone === 'neutral' ? 'text-muted-foreground' : SELECTED_TEXT[tone];
  return (
    <View
      className={`flex-row items-center self-start rounded-full ${
        size === 'sm' ? 'min-h-6 gap-1 px-2 py-0.5' : 'min-h-7 gap-1.5 px-2.5 py-0.5'
      } ${container}`}
    >
      {icon}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_SCALE.chrome}
        className={`text-xs ${text} ${mono ? 'font-mono' : ''}`}
      >
        {label}
      </Text>
    </View>
  );
}

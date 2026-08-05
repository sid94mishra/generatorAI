// ────────────────────────────────────────────────────────────────
// ListRow — the grouped-list row used across settings and every catalogue.
//
// 56pt minimum height, leading icon in a tinted square, title + optional
// subtitle, trailing slot, optional chevron. Having one component means the
// alignment of forty rows across ten screens cannot drift.
//
// A row with a trailing switch takes `toggle` rather than a `<Switch>` in
// `trailing`: putting the control in a sibling node leaves the label and the
// switch as two unrelated accessibility elements, so the switch announces
// "on" with no idea what is on, and the row's help text is unreachable.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Switch as RNSwitch, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { Touchable } from './Touchable';
import { haptics } from './haptics';
import { useTheme } from '../../theme/ThemeProvider';

export function ListRow({
  title,
  subtitle,
  icon,
  iconTint,
  trailing,
  onPress,
  onLongPress,
  chevron,
  destructive = false,
  selected = false,
  disabled = false,
  toggle,
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string | null;
  icon?: React.ReactNode;
  /** Background of the icon square. Defaults to the neutral surface. */
  iconTint?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Defaults to true when `onPress` is supplied. */
  chevron?: boolean;
  destructive?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** Renders a switch AND makes the whole row toggle it, as one a11y node. */
  toggle?: { value: boolean; onValueChange: (next: boolean) => void };
  accessibilityLabel?: string;
  accessibilityHint?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  const showChevron = chevron ?? (Boolean(onPress) && !toggle);

  const body = (
    <View className="min-h-14 flex-row items-center gap-3 px-4 py-2.5">
      {icon ? (
        <View
          className="h-9 w-9 items-center justify-center rounded-2xl bg-subtle"
          style={iconTint ? { backgroundColor: iconTint } : undefined}
        >
          {icon}
        </View>
      ) : null}

      <View className="flex-1 gap-0.5">
        <Text
          numberOfLines={2}
          className={`text-md font-medium ${destructive ? 'text-danger' : 'text-foreground'}`}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={3} className="text-sm text-muted-foreground">
            {subtitle}
          </Text>
        ) : null}
      </View>

      {toggle ? (
        <RNSwitch
          // Not focusable on its own: the row owns the switch role below, so
          // leaving this reachable would announce the same control twice.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          value={toggle.value}
          disabled={disabled}
          onValueChange={(next) => {
            haptics.select();
            toggle.onValueChange(next);
          }}
          trackColor={{ false: colors.emphasis ?? '', true: colors.primary ?? '' }}
          thumbColor={colors.background}
          ios_backgroundColor={colors.emphasis}
        />
      ) : (
        trailing
      )}
      {showChevron ? <ChevronRight size={18} color={colors['muted-foreground']} /> : null}
    </View>
  );

  if (!onPress && !toggle && !onLongPress) {
    return <View className={selected ? 'bg-accent' : undefined}>{body}</View>;
  }

  return (
    <Touchable
      a11yRole={toggle ? 'switch' : 'button'}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint ?? (subtitle && !toggle ? subtitle : undefined)}
      accessibilityState={toggle ? { checked: toggle.value } : { selected }}
      disabled={disabled}
      haptic={toggle ? 'none' : 'tap'}
      scale="large"
      onPress={toggle ? () => toggle.onValueChange(!toggle.value) : onPress}
      {...(onLongPress ? { onLongPress } : {})}
      className={selected ? 'bg-accent' : undefined}
    >
      {body}
    </Touchable>
  );
}

/**
 * A group of rows with hairlines between them but not at the edges — the
 * iOS inset-grouped table look.
 */
export function ListGroup({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View className={`overflow-hidden rounded-3xl border border-border bg-card ${className}`}>
      {items.map((child, i) => (
        // Index keys are correct here: the group is a static layout wrapper,
        // and the children carry their own identity.
        <View key={i}>
          {i > 0 ? <View className="ml-4 h-px bg-border-muted" /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// Status states — empty, error, locked, loading.
//
// Every list in the app renders exactly one of these, which is how a screen
// stops being able to sit blank with no explanation. HIG is explicit about
// this for tab destinations: never disable or hide a destination, explain
// why its content is unavailable.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { AlertTriangle, Inbox, Lock } from 'lucide-react-native';

import { Button } from './Button';
import { useTheme } from '../../theme/ThemeProvider';

export function Spinner({
  tone = 'muted',
  size = 'small',
  label = 'Loading',
}: {
  tone?: 'muted' | 'primary';
  size?: 'small' | 'large';
  label?: string;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <ActivityIndicator
      accessibilityLabel={label}
      size={size}
      color={tone === 'primary' ? colors.primary : colors['muted-foreground']}
    />
  );
}

export function LoadingState({ label }: { label?: string }): React.ReactElement {
  return (
    <View
      accessibilityLiveRegion="polite"
      className="flex-1 items-center justify-center gap-3 py-12"
    >
      <Spinner size="large" label={label ?? 'Loading'} />
      {label ? <Text className="text-sm text-muted-foreground">{label}</Text> : null}
    </View>
  );
}

function Frame({
  icon,
  title,
  message,
  action,
  live = 'polite',
  compact = false,
}: {
  icon: React.ReactNode;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
  live?: 'none' | 'polite' | 'assertive';
  /**
   * The pane variant: a title, one line of help and the action, at a third
   * of the height. Panes are switched between constantly during a turn, and
   * a 120pt illustrated paragraph every time you glance at Changes is noise.
   * The full treatment stays for tab-level empties, which are read once.
   */
  compact?: boolean;
}): React.ReactElement {
  if (compact) {
    return (
      <View accessibilityLiveRegion={live} className="items-center gap-2 px-8 py-7">
        <View className="flex-row items-center gap-2">
          {icon}
          <Text accessibilityRole="header" className="text-md font-semibold text-foreground">
            {title}
          </Text>
        </View>
        {message ? (
          <Text numberOfLines={2} className="text-center text-xs leading-relaxed text-muted-foreground">
            {message}
          </Text>
        ) : null}
        {action ? (
          <View className="self-center pt-0.5">
            <Button label={action.label} onPress={action.onPress} variant="secondary" size="sm" />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View accessibilityLiveRegion={live} className="items-center gap-3 px-8 py-12">
      <View className="h-14 w-14 items-center justify-center rounded-3xl bg-control">{icon}</View>
      <Text accessibilityRole="header" className="text-center text-lg font-semibold text-foreground">
        {title}
      </Text>
      {message ? (
        <Text className="text-center text-sm leading-relaxed text-muted-foreground">{message}</Text>
      ) : null}
      {action ? (
        // `Button` defaults to `self-start`, which overrode the frame's
        // `items-center` and left the action hanging off the left edge under
        // a centred title (seen on the Terminal pane's "New terminal").
        <View className="self-center">
          <Button label={action.label} onPress={action.onPress} variant="secondary" size="md" />
        </View>
      ) : null}
    </View>
  );
}

export function EmptyState({
  title = 'Nothing here yet',
  message,
  icon,
  action,
  compact = false,
}: {
  title?: string;
  message?: string;
  icon?: React.ReactNode;
  action?: { label: string; onPress: () => void };
  /** The dense variant for a session pane. See `Frame`. */
  compact?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Frame
      icon={icon ?? <Inbox size={compact ? 16 : 24} color={colors['muted-foreground']} />}
      title={title}
      compact={compact}
      {...(message ? { message } : {})}
      {...(action ? { action } : {})}
    />
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Frame
      icon={<AlertTriangle size={24} color={colors.danger} />}
      title={title}
      // A failure interrupts: it is the one state worth cutting across
      // whatever the screen reader is currently saying.
      live="assertive"
      {...(message ? { message } : {})}
      {...(onRetry ? { action: { label: 'Try again', onPress: onRetry } } : {})}
    />
  );
}

/**
 * A capability this device is not permitted to use.
 *
 * Distinct from `EmptyState` on purpose: "there is nothing" and "you are not
 * allowed to see this" are different facts, and conflating them is how a
 * scope-gated screen ends up looking broken.
 */
export function LockedState({
  title,
  reason,
  action,
}: {
  title: string;
  reason: string;
  action?: { label: string; onPress: () => void };
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Frame
      icon={<Lock size={22} color={colors['muted-foreground']} />}
      title={title}
      message={reason}
      {...(action ? { action } : {})}
    />
  );
}

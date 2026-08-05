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
}: {
  icon: React.ReactNode;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
  live?: 'none' | 'polite' | 'assertive';
}): React.ReactElement {
  return (
    <View accessibilityLiveRegion={live} className="items-center gap-3 px-8 py-12">
      <View className="h-14 w-14 items-center justify-center rounded-3xl bg-subtle">{icon}</View>
      <Text accessibilityRole="header" className="text-center text-lg font-semibold text-foreground">
        {title}
      </Text>
      {message ? (
        <Text className="text-center text-sm leading-relaxed text-muted-foreground">{message}</Text>
      ) : null}
      {action ? (
        <Button label={action.label} onPress={action.onPress} variant="secondary" size="sm" />
      ) : null}
    </View>
  );
}

export function EmptyState({
  title = 'Nothing here yet',
  message,
  icon,
  action,
}: {
  title?: string;
  message?: string;
  icon?: React.ReactNode;
  action?: { label: string; onPress: () => void };
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Frame
      icon={icon ?? <Inbox size={24} color={colors['muted-foreground']} />}
      title={title}
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

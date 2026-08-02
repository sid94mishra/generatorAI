// ────────────────────────────────────────────────────────────────
// Surface primitives — the elevation ladder.
//
// background → card → raised → overlay. Shadows are reserved for things that
// genuinely float (sheet, FAB, toast); everything else separates with the
// surface colour and a hairline border. On a phone, drop shadows under static
// content just make the screen look muddy in dark mode.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View, type ViewProps } from 'react-native';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

// Opacity modifiers (`bg-primary/15`) are avoided throughout: the palette is
// delivered as bare `var(--x)` strings, which Tailwind cannot decompose into
// an alpha-capable form, so the modifier is silently dropped. Every tone below
// therefore uses a real token.
const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-subtle border-border-muted',
  primary: 'bg-accent border-primary',
  success: 'bg-success-muted border-success',
  warning: 'bg-warning-muted border-warning',
  danger: 'bg-danger-muted border-danger',
  info: 'bg-info-muted border-info',
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-muted-foreground',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export function Card({
  className = '',
  children,
  ...rest
}: ViewProps & { className?: string }): React.ReactElement {
  return (
    <View className={`rounded-3xl border border-border bg-card ${className}`} {...rest}>
      {children}
    </View>
  );
}

/** One step above `Card` — used for nested content inside a card or sheet. */
export function Surface({
  className = '',
  children,
  ...rest
}: ViewProps & { className?: string }): React.ReactElement {
  return (
    <View className={`rounded-2xl bg-raised ${className}`} {...rest}>
      {children}
    </View>
  );
}

/** Grouped-list header. Sentence case, not all-caps — matches iOS 17+. */
export function SectionHeader({
  title,
  action,
  className = '',
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <View className={`flex-row items-center justify-between px-1 pb-2 pt-4 ${className}`}>
      <Text className="text-sm font-semibold text-muted-foreground">{title}</Text>
      {action}
    </View>
  );
}

export function Divider({ className = '' }: { className?: string }): React.ReactElement {
  return <View className={`h-px bg-border-muted ${className}`} />;
}

export function Badge({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: Tone;
  icon?: React.ReactNode;
}): React.ReactElement {
  return (
    <View
      className={`flex-row items-center gap-1 self-start rounded-full border px-2 py-0.5 ${TONE_BADGE[tone]}`}
    >
      {icon}
      <Text className={`text-xs font-medium ${TONE_TEXT[tone]}`}>{label}</Text>
    </View>
  );
}

/**
 * A 8pt status dot.
 *
 * `pulse` is deliberately a static ring rather than an animation: a list of
 * twenty running items with twenty looping animations is a measurable battery
 * cost for no added information.
 */
export function StatusDot({
  tone,
  ring = false,
}: {
  tone: Tone;
  ring?: boolean;
}): React.ReactElement {
  return (
    <View className={ring ? `rounded-full p-0.5 ${TONE_BADGE[tone]}` : undefined}>
      <View className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
    </View>
  );
}

export { TONE_TEXT, TONE_BADGE, TONE_DOT };

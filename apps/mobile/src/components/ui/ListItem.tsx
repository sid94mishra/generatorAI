// ────────────────────────────────────────────────────────────────
// ListItem — the flat row every catalogue list is built from.
//
// Chats, runs, workflows, automations, projects, agents and the Home feed
// each had their own bordered card with the same grey glyph, three paddings
// and two title line limits. One row, per the design spec:
//
//   ┌────┐  Title (1 line, semibold)                    time
//   │ ◉ •│  Subtitle (1 line, muted, text-sm)   [badge] [accessory]
//   └────┘
//   ───────  hairline, inset 52pt so it lines up with the text
//
// • The leading `StatusAvatar` carries STATE: a flat 24pt glyph, tinted, with
//   the kind/provider glyph, plus a small corner dot while something is
//   running or waiting. Colour only ever means status.
// • `badge` is for a non-default state only ("Failed", "Off"). A row shows
//   one status signal — dot OR badge — so callers pick one.
// • `accessory` is a trailing slot for a control (a switch, a button).
//   Presses inside it do not open the row.
// • `titleBadge` sits inline after the title — "Sub-agent".
//
// 64pt minimum height; grows with reading size instead of clipping.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';

import { Touchable } from './Touchable';
import { Badge, type Tone } from './primitives';
import { MAX_SCALE } from './accessibility';

const DOT_BG: Record<Tone, string> = {
  neutral: 'bg-muted-foreground',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

/** Colour token NAME per tone, for tinting a glyph via `useTheme().colors`. */
export const TONE_COLOR_TOKEN: Record<Tone, string> = {
  neutral: 'muted-foreground',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

export interface StatusAvatarProps {
  /** The kind or provider glyph, ~18px. Tint it with the tone colour. */
  icon: React.ReactNode;
  tone?: Tone;
  /**
   * A corner dot for live state. Pass the tone the dot should take — usually
   * `info` for running and `warning` for waiting. Omit for settled rows.
   */
  indicator?: Tone | null;
  size?: number;
}

export function StatusAvatar({ icon, indicator, size = 24 }: StatusAvatarProps): React.ReactElement {
  // Flat: the glyph and the text, no tile behind the glyph. Desktop's lists
  // and sidebar draw bare icons, and a filled tile on every row read as a
  // column of grey blocks. The glyph's own tint and the corner dot carry state.
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center"
      style={{ width: size, height: size }}
    >
      {icon}
      {indicator ? (
        <View
          className={`absolute h-2.5 w-2.5 rounded-full border-2 border-background ${DOT_BG[indicator]}`}
          style={{ right: -3, bottom: -2 }}
        />
      ) : null}
    </View>
  );
}

export interface ListItemProps {
  title: string;
  subtitle?: string | null;
  /** Trailing text on the title line — usually a relative time. */
  meta?: string | null;
  avatar?: StatusAvatarProps;
  /** Inline after the title (e.g. a "Sub-agent" badge). */
  titleBadge?: { label: string; tone?: Tone } | null;
  /** Non-default state only. */
  badge?: { label: string; tone: Tone } | null;
  /** Trailing control slot (a switch, an icon button). */
  accessory?: React.ReactNode;
  /** Colour the subtitle — `danger` for an error line. Defaults to muted. */
  subtitleTone?: 'muted' | 'danger' | 'warning';
  /** Draw the inset hairline under the row. Default true. */
  separator?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

const SUBTITLE_TONE = {
  muted: 'text-muted-foreground',
  danger: 'text-danger',
  warning: 'text-warning',
} as const;

export function ListItem({
  title,
  subtitle,
  meta,
  avatar,
  titleBadge,
  badge,
  accessory,
  subtitleTone = 'muted',
  separator = true,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ListItemProps): React.ReactElement {
  const body = (
    <View className="min-h-16 flex-row items-center gap-3 px-4 py-2.5">
      {avatar ? <StatusAvatar {...avatar} /> : null}

      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_SCALE.control}
            className="shrink text-md font-semibold text-foreground"
          >
            {title}
          </Text>
          {titleBadge ? <Badge label={titleBadge.label} tone={titleBadge.tone ?? 'neutral'} /> : null}
          <View className="flex-1" />
          {meta ? (
            <Text numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-sm text-muted-foreground">
              {meta}
            </Text>
          ) : null}
        </View>
        {subtitle || badge ? (
          <View className="flex-row items-center gap-2">
            {subtitle ? (
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_SCALE.control}
                className={`flex-1 text-sm ${SUBTITLE_TONE[subtitleTone]}`}
              >
                {subtitle}
              </Text>
            ) : (
              <View className="flex-1" />
            )}
            {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
          </View>
        ) : null}
      </View>

      {accessory ? <View>{accessory}</View> : null}
    </View>
  );

  const content = onPress || onLongPress ? (
    <Touchable
      accessibilityLabel={accessibilityLabel ?? [title, badge?.label, subtitle, meta].filter(Boolean).join(', ')}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      {...(testID ? { testID } : {})}
      haptic="tap"
      scale="none"
      {...(onPress ? { onPress } : {})}
      {...(onLongPress ? { onLongPress } : {})}
    >
      {body}
    </Touchable>
  ) : (
    <View
      accessible={!accessory}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      {...(testID ? { testID } : {})}
    >
      {body}
    </View>
  );

  return (
    <View className="bg-background">
      {content}
      {separator ? <View className="h-px bg-border-muted" style={{ marginLeft: avatar ? 52 : 16 }} /> : null}
    </View>
  );
}

/**
 * A section label inside a flat list — "Today", "Needs you". Sentence case,
 * aligned with the row text gutter.
 */
export function ListSectionHeader({
  label,
  count,
  action,
}: {
  label: string;
  count?: number;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <View className="flex-row items-center justify-between bg-background px-4 pb-1.5 pt-5">
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_SCALE.chrome}
        className="text-sm font-semibold text-muted-foreground"
      >
        {label}
        {count !== undefined ? ` · ${count}` : ''}
      </Text>
      {action}
    </View>
  );
}

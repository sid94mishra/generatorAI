// ────────────────────────────────────────────────────────────────
// StatRail — the two numbers worth the top of Home.
//
// It used to be five horizontally scrolling tiles: Needs you, Running,
// Chats, Runs and server health. Chats and Runs restated the tab bar
// directly below them, health restated the server card directly below that,
// and nothing was ever off-screen — so the strip cost a third of the first
// screen and its scroll affordance was a lie.
//
// Two tiles, side by side, no scroller: the two questions a phone is opened
// to answer. Both are pressable and both go somewhere.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';

import { Card, type Tone } from '../ui/primitives';
import { Touchable } from '../ui/Touchable';
import { Skeleton } from '../ui/Skeleton';
import { MAX_SCALE, useFontScale } from '../ui/accessibility';
import { useTheme } from '../../theme/ThemeProvider';

export interface StatItem {
  id: string;
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: Tone;
  onPress?: () => void;
}

export function StatRail({ items, loading }: { items: StatItem[]; loading: boolean }): React.ReactElement {
  if (loading) {
    return (
      <View className="flex-row gap-2.5">
        <View className="flex-1">
          <Skeleton height={84} radius={16} />
        </View>
        <View className="flex-1">
          <Skeleton height={84} radius={16} />
        </View>
      </View>
    );
  }
  return (
    <View className="flex-row gap-2.5">
      {items.map((item) => (
        <Stat key={item.id} {...item} />
      ))}
    </View>
  );
}

function Stat({ label, value, icon, tone = 'neutral', onPress }: StatItem): React.ReactElement {
  const { colors } = useTheme();
  const fontScale = useFontScale();
  // The tile grows with the reading size rather than clipping its own number.
  const minHeight = Math.round(84 * Math.min(Math.max(fontScale, 1), 1.6));
  const live = tone !== 'neutral';

  const body = (
    <Card
      className="justify-between p-3.5"
      style={{
        minHeight,
        ...(live ? { borderColor: tone === 'warning' ? colors.warning : colors.info } : {}),
      }}
    >
      <View className="flex-row items-center gap-2">
        {icon}
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCALE.chrome}
          className="flex-1 text-xs text-muted-foreground"
        >
          {label}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_SCALE.control}
        className="text-3xl font-bold text-foreground"
        style={live ? { color: tone === 'warning' ? colors.warning : colors.info } : undefined}
      >
        {value}
      </Text>
    </Card>
  );

  if (!onPress) {
    return (
      <View className="flex-1" accessible accessibilityLabel={`${label}: ${value}`}>
        {body}
      </View>
    );
  }

  return (
    <Touchable
      accessibilityLabel={`${label}: ${value}`}
      haptic="tap"
      scale="large"
      onPress={onPress}
      className="flex-1"
    >
      {body}
    </Touchable>
  );
}

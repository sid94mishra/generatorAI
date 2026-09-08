// ────────────────────────────────────────────────────────────────
// StatRail — the glanceable numbers under the greeting.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Card, StatusDot, type Tone } from '../ui/primitives';
import { Touchable } from '../ui/Touchable';
import { Skeleton } from '../ui/Skeleton';
import { MAX_SCALE, useFontScale } from '../ui/accessibility';

export interface StatItem {
  id: string;
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone?: Tone;
  onPress?: () => void;
}

export function StatRail({ items, loading }: { items: StatItem[]; loading: boolean }): React.ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 10, paddingRight: 8 }}
    >
      {loading ? (
        <>
          <Skeleton width={132} height={86} radius={16} />
          <Skeleton width={132} height={86} radius={16} />
          <Skeleton width={132} height={86} radius={16} />
        </>
      ) : (
        items.map((item) => <Stat key={item.id} {...item} />)
      )}
    </ScrollView>
  );
}

function Stat({ label, value, icon, tone = 'neutral', onPress }: StatItem): React.ReactElement {
  const fontScale = useFontScale();
  // The tile grows with the reading size rather than clipping its own number.
  const height = Math.round(86 * Math.min(Math.max(fontScale, 1), 1.6));
  const width = Math.round(132 * Math.min(Math.max(fontScale, 1), 1.35));

  const body = (
    <Card
      className={`justify-between p-3 ${tone !== 'neutral' ? 'border-primary' : ''}`}
      style={{ height, width }}
    >
      <View className="flex-row items-center justify-between">
        {icon}
        <StatusDot tone={tone} label={null} />
      </View>
      <View>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCALE.control}
          className="text-2xl font-bold text-foreground"
        >
          {value}
        </Text>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCALE.chrome}
          className="text-xs text-muted-foreground"
        >
          {label}
        </Text>
      </View>
    </Card>
  );

  // A tile with nowhere to go is not a button.
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={`${label}: ${value}`}>
        {body}
      </View>
    );
  }

  return (
    <Touchable accessibilityLabel={`${label}: ${value}`} haptic="tap" scale="large" onPress={onPress}>
      {body}
    </Touchable>
  );
}

// ────────────────────────────────────────────────────────────────
// Usage footer — what the turn cost.
//
// Web renders this as a hoverable chip. There is no hover on a phone, so the
// numbers that matter are always visible and the rest is one tap away.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Coins } from 'lucide-react-native';
import type { StreamUsage } from '@generatorai/client-core';

import { Touchable } from '../ui/Touchable';
import { formatDuration } from './toolPresentation';
import { useTheme } from '../../theme/ThemeProvider';

function compact(n: number | undefined): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function UsageFooter({ usage }: { usage: StreamUsage }): React.ReactElement {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const duration = formatDuration(usage.durationMs);

  return (
    <Touchable
      accessibilityLabel="Turn usage details"
      haptic="tap"
      scale="large"
      onPress={() => setExpanded((v) => !v)}
      className="self-start rounded-2xl bg-subtle px-3 py-2"
    >
      <View className="flex-row items-center gap-2">
        <Coins size={12} color={colors['muted-foreground']} />
        <Text className="text-xs text-muted-foreground">
          {usage.model} · {compact(usage.inputTokens)} in · {compact(usage.outputTokens)} out
          {duration ? ` · ${duration}` : ''}
        </Text>
      </View>

      {expanded ? (
        <Animated.View entering={FadeIn.duration(120)} className="mt-2 gap-0.5">
          <Detail label="Input" value={compact(usage.inputTokens)} />
          <Detail label="Output" value={compact(usage.outputTokens)} />
          {usage.cacheReadTokens ? (
            <Detail label="Cache read" value={compact(usage.cacheReadTokens)} />
          ) : null}
          {usage.cacheWriteTokens ? (
            <Detail label="Cache write" value={compact(usage.cacheWriteTokens)} />
          ) : null}
          {usage.provider ? <Detail label="Provider" value={usage.provider} /> : null}
          {usage.cost !== undefined ? (
            <Detail label="Cost" value={`$${usage.cost.toFixed(4)}`} />
          ) : null}
        </Animated.View>
      ) : null}
    </Touchable>
  );
}

function Detail({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View className="flex-row justify-between gap-6">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="font-mono text-xs text-foreground">{value}</Text>
    </View>
  );
}

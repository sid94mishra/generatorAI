// ────────────────────────────────────────────────────────────────
// Usage footer — what the turn cost.
//
// Web renders this as a hoverable chip. There is no hover on a phone, so the
// numbers that matter are always visible and the rest is one tap away.
//
// The cache-miss hint follows web's `UsageChip` rule: a miss is only
// reported once this chat has proven it caches (a previous turn read or
// wrote the prompt cache), so a first turn is never accused of missing.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ChevronDown, Coins, TriangleAlert, Zap } from 'lucide-react-native';
import type { StreamUsage } from '@generatorai/client-core';

import { Touchable } from '../ui/Touchable';
import { formatDuration } from './toolPresentation';
import { cacheMissHint, compactTokens as compact } from './timeline/deriveTimeline';
import { useTheme } from '../../theme/ThemeProvider';
import { useChatMotion } from './chatMotion';

export function UsageFooter({
  usage,
  previous = null,
}: {
  usage: StreamUsage;
  /** The chat's previous turn usage, for the cache-miss rule. */
  previous?: StreamUsage | null;
}): React.ReactElement {
  const motion = useChatMotion();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const duration = formatDuration(usage.durationMs);
  const cached = usage.cacheReadTokens ?? 0;
  const hint = cacheMissHint(usage, previous);
  const cost = usage.cost !== undefined ? `$${usage.cost < 0.01 ? usage.cost.toFixed(4) : usage.cost.toFixed(2)}` : null;

  return (
    <Touchable
      accessibilityLabel={`Turn usage: ${usage.model}${duration ? `, ${duration}` : ''}${cost ? `, ${cost}` : ''}${hint ? `. ${hint}` : ''}`}
      accessibilityHint="Shows the token breakdown"
      accessibilityState={{ expanded }}
      haptic="tap"
      scale="large"
      onPress={() => setExpanded((v) => !v)}
      className={`self-start rounded-2xl px-3 py-2 ${hint ? 'border border-warning bg-warning-muted' : 'bg-subtle'}`}
    >
      {/* Collapsed, this says the three things that are read: which model,
          how long, what it cost. The arrows-and-lightning token line needed a
          legend nobody has — it now lives one tap down with its labels. */}
      <View className="flex-row items-center gap-2">
        {hint ? <TriangleAlert size={12} color={colors.warning} /> : <Coins size={12} color={colors['muted-foreground']} />}
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {usage.model}
          {duration ? ` · ${duration}` : ''}
          {cost ? ` · ${cost}` : ''}
        </Text>
        <ChevronDown
          size={12}
          color={colors['muted-foreground']}
          style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        />
      </View>

      {expanded ? (
        <Animated.View entering={motion.fadeIn(120)} className="mt-2 gap-0.5">
          <Detail label="Sent" value={compact(usage.inputTokens)} />
          <Detail label="Received" value={compact(usage.outputTokens)} />
          {duration ? <Detail label="Took" value={duration} /> : null}
          {cached > 0 ? <Detail label="Cache read" value={compact(cached)} icon={<Zap size={11} color={colors.success} />} /> : null}
          {usage.cacheWriteTokens ? <Detail label="Cache write" value={compact(usage.cacheWriteTokens)} /> : null}
          {usage.provider ? <Detail label="Provider" value={usage.provider} /> : null}
          {cost ? <Detail label="Cost" value={cost} /> : null}
          {hint ? <Text className="mt-1 text-xs text-warning">{hint}</Text> : null}
        </Animated.View>
      ) : null}
    </Touchable>
  );
}

function Detail({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }): React.ReactElement {
  return (
    <View className="flex-row items-center justify-between gap-6">
      <View className="flex-row items-center gap-1">
        {icon}
        <Text className="text-xs text-muted-foreground">{label}</Text>
      </View>
      <Text className="font-mono text-xs text-foreground">{value}</Text>
    </View>
  );
}

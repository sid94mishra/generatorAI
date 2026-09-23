// ────────────────────────────────────────────────────────────────
// HealthCard — the server's own status, from the snapshot Home already polls.
//
// Read-only. Tap → Settings › Diagnostics, which is where the detail lives.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, ServerCog } from 'lucide-react-native';
import type { HealthSnapshot } from '@generatorai/client-core';

import { formatDuration } from '../runs/formatTime';
import { Badge, Card, StatusDot } from '../ui/primitives';
import { Touchable } from '../ui/Touchable';
import { Skeleton } from '../ui/Skeleton';
import { useTheme } from '../../theme/ThemeProvider';

export function HealthCard({ health }: { health: HealthSnapshot | undefined }): React.ReactElement {
  const { colors } = useTheme();

  if (!health) {
    return <Skeleton height={72} radius={16} />;
  }

  const ok = health.status === 'ok';
  const harnessOk = health.harness.healthy;
  const tone = ok && harnessOk ? 'success' : 'warning';
  const headline = ok ? (harnessOk ? 'Server healthy' : 'Harness degraded') : 'Server degraded';
  // The harness name is already the trailing badge; repeating it here made
  // the detail line 196pt wide in a 157pt column, so the uptime — the one
  // part that changes — was the half that got truncated away.
  const detail = [
    ...(harnessOk ? [] : [`${health.harness.type} unhealthy`]),
    health.db ? 'database ok' : 'database down',
    `up ${formatDuration(Math.max(0, health.uptime) * 1000)}`,
  ].join(' · ');
  const live = `${health.activeChats} chat${health.activeChats === 1 ? '' : 's'} · ${health.activeWorkflowRuns} run${health.activeWorkflowRuns === 1 ? '' : 's'} active`;

  return (
    <Touchable
      accessibilityLabel={`${headline}. ${detail}. ${live}`}
      accessibilityHint="Opens diagnostics"
      haptic="tap"
      scale="large"
      onPress={() => router.push('/settings/diagnostics')}
    >
      <Card className="flex-row items-center gap-3 p-3.5">
        <View className="h-9 w-9 items-center justify-center">
          <ServerCog size={16} color={tone === 'success' ? colors.success : colors.warning} />
        </View>
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-1.5">
            <StatusDot tone={tone} label={null} />
            <Text numberOfLines={1} className="text-md font-medium text-foreground">
              {headline}
            </Text>
          </View>
          <Text numberOfLines={1} className="text-sm text-muted-foreground">
            {detail}
          </Text>
          <Text numberOfLines={1} className="text-sm text-muted-foreground">
            {live}
          </Text>
        </View>
        <Badge label={health.harness.type} tone="neutral" />
        <ChevronRight size={18} color={colors['muted-foreground']} />
      </Card>
    </Touchable>
  );
}

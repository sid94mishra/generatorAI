// MB-40 StatsCards (03 MB-40; MHome, MHomeMore, MAutomationDetail): ML-18 bound to the stats summary and the
// server's system info — the "This week" strip, the automation strip and the server footer link ("● This computer
// local:3100 · 0.0.1-alpha.1 ›" → the server switcher). Count tiles are plain ML-18 `tiles` fed by the screen.
import React from 'react';
import { View } from 'react-native';
import { HEALTH } from '@generatorai/shared';

import { useConnectionHealth } from '../ConnectionStatus';
import { StatStrip } from '../../ui/layout/StatStrip';
import { Icon } from '../../ui/primitives/Icon';
import { Pressable } from '../../ui/primitives/Pressable';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { serverFooterDetail, weekStatItems } from './statsModel';
import { useStatsSummary, useSystemInfo } from './StatsCards.queries';

/** "This week": the ISO week from Monday 00:00 local to now (MD-84). Hidden until the summary arrives. */
export function WeekStatsStrip({ range, testID = 'home-week' }: { range: { from: string; to: string }; testID?: string }): React.ReactElement | null {
  const summary = useStatsSummary(range);
  if (!summary.data) return null;
  return <StatStrip variant="strip" items={weekStatItems(summary.data)} testID={testID} />;
}

export function ServerFooterLink({ onPress, testID = 'home-server' }: { onPress: () => void; testID?: string }): React.ReactElement {
  const info = useSystemInfo();
  const { health, address } = useConnectionHealth();
  const name = info.data?.serverName ?? 'This server';
  const detail = serverFooterDetail(address, info.data);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${name}, ${HEALTH.connection[health].label}${detail ? `, ${detail}` : ''}. Switch server`} testID={testID}>
      <View className="min-h-row flex-row items-center justify-center gap-2 px-4">
        <StatusDot health={HEALTH.connection[health].tone} size="sm" />
        <Text role="footnote" tone="fg-2" numberOfLines={1}>
          {name}
        </Text>
        {detail ? (
          <Text role="monoSm" tone="fg-3" numberOfLines={1} className="flex-shrink">
            {detail}
          </Text>
        ) : null}
        <Icon concept="chevron-right" size={14} tone="fg-3" />
      </View>
    </Pressable>
  );
}

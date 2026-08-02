// ────────────────────────────────────────────────────────────────
// Status pill.
//
// Presentation only — the colour and label mapping lives in `statusStyle.ts`
// so it can be tested and shared with the timeline rail and activity feed.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';

import { statusLabel, statusStyle, type AnyRunStatus } from './statusStyle';

export function RunStatusPill({ status }: { status: AnyRunStatus }): React.ReactElement {
  const [bg, fg] = statusStyle(status);
  return (
    <View className={`rounded-full px-2 py-0.5 ${bg}`}>
      <Text className={`text-[11px] font-medium ${fg}`}>{statusLabel(status)}</Text>
    </View>
  );
}

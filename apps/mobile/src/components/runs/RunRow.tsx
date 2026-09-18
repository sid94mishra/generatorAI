// ────────────────────────────────────────────────────────────────
// RunRow — a flat, 64pt run row (spec: flat rows, one status signal).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import type { WorkflowRunSummary } from '@generatorai/client-core';

import { formatDuration, relativeTime, runElapsed } from './formatTime';
import { runTitle } from './runModel';
import { isActive, statusLabel } from './statusStyle';
import { StatusGlyph } from './StatusGlyph';
import { Touchable } from '../ui/Touchable';

export function RunRow({
  run,
  subtitle,
}: {
  run: WorkflowRunSummary;
  /** Replaces the default "status · duration" line. */
  subtitle?: string;
}): React.ReactElement {
  const elapsed = runElapsed(run, isActive(run.status) ? null : run.completedAt ?? run.updatedAt);
  const line =
    subtitle ??
    `${statusLabel(run.status)}${elapsed != null ? ` · ${formatDuration(elapsed)}` : ''}`;

  return (
    <Touchable
      accessibilityLabel={`${runTitle(run.name)}, ${statusLabel(run.status)}`}
      haptic="tap"
      onPress={() => router.push(`/runs/${run.id}`)}
    >
      <View className="min-h-16 flex-row items-center gap-3 px-4 py-2.5">
        <StatusGlyph status={run.status} />
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-baseline gap-2">
            <Text numberOfLines={1} className="flex-1 text-md font-semibold text-foreground">
              {runTitle(run.name)}
            </Text>
            <Text className="text-sm text-muted-foreground">{relativeTime(run.updatedAt)}</Text>
          </View>
          <Text numberOfLines={1} className={`text-sm ${run.error ? 'text-danger' : 'text-muted-foreground'}`}>
            {run.error && run.status === 'failed' ? run.error : line}
          </Text>
        </View>
      </View>
    </Touchable>
  );
}

/** Hairline-separated flat list, separators inset to the text column. */
export function FlatRows({ children }: { children: React.ReactNode }): React.ReactElement {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View className="-mx-4">
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View className="h-px bg-border-muted" style={{ marginLeft: 64 }} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

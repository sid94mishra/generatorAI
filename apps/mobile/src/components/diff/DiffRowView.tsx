// ────────────────────────────────────────────────────────────────
// Diff row renderer.
//
// Unified layout on phones. Side-by-side needs ~160 columns to be readable
// and a phone has ~40; splitting it produces two unreadable columns instead
// of one readable one.
//
// Rows are virtualized by the caller (LegendList): a 5,000-line diff is
// normal for a refactor, and rendering it eagerly drops frames for seconds.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import type { DiffHunk, DiffRow } from '@generatorai/client-core';

/** Gutter width fits 5 digits — beyond that the file is not phone-reviewable. */
const GUTTER = 'w-10';

export function DiffHunkHeader({ hunk }: { hunk: DiffHunk }): React.ReactElement {
  return (
    <View className="border-y border-border bg-subtle px-2 py-1.5">
      <Text className="font-mono text-[11px] text-muted-foreground" numberOfLines={1}>
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        {hunk.section ? ` ${hunk.section}` : ''}
      </Text>
    </View>
  );
}

export const DiffRowView = React.memo(function DiffRowView({
  row,
  onPress,
}: {
  row: DiffRow;
  onPress?: (row: DiffRow) => void;
}): React.ReactElement {
  const background =
    row.kind === 'add' ? 'bg-success-muted' : row.kind === 'del' ? 'bg-danger-muted' : '';
  const marker = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' ';
  const markerColour =
    row.kind === 'add' ? 'text-success' : row.kind === 'del' ? 'text-danger' : 'text-muted-foreground';

  return (
    <View
      className={`flex-row ${background}`}
      accessibilityRole={onPress ? 'button' : undefined}
      onTouchEnd={onPress ? () => onPress(row) : undefined}
    >
      <Text className={`${GUTTER} px-1 text-right font-mono text-[11px] text-muted-foreground`}>
        {row.oldNumber ?? ''}
      </Text>
      <Text className={`${GUTTER} px-1 text-right font-mono text-[11px] text-muted-foreground`}>
        {row.newNumber ?? ''}
      </Text>
      <Text className={`w-4 text-center font-mono text-xs ${markerColour}`}>{marker}</Text>
      {/*
        No wrapping: a wrapped code line destroys the visual alignment that
        makes a diff scannable. The whole surface scrolls horizontally instead.
      */}
      <Text className="flex-1 font-mono text-xs text-foreground" numberOfLines={1}>
        {row.content || ' '}
      </Text>
      {row.noNewline ? (
        <Text className="px-1 font-mono text-[10px] text-warning">↵</Text>
      ) : null}
    </View>
  );
});

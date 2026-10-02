// ────────────────────────────────────────────────────────────────
// Diff row renderer for the legacy timeline's InlineDiff (kept until M8-03): the kit CodeLine with the diff
// preferences the DiffView uses (blocks/DiffView), so a hunk in the stage transcript reads like the Changes diff.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { View } from 'react-native';
import type { DiffHunk, DiffRow } from '@generatorai/client-core';

import { gutterWidthFor, hunkLabel, useDiffPrefs } from '../../blocks/DiffView';
import { CodeLine } from '../../ui/primitives/CodeLine';
import { Text } from '../../ui/primitives/Text';

/** Gutter sized for 5 digits — beyond that the file is not phone-reviewable. */
const GUTTER_DIGITS = 99_999;

export function DiffHunkHeader({ hunk }: { hunk: DiffHunk }): React.ReactElement {
  return (
    <View className="bg-sunken px-3 py-1">
      <Text role="monoSm" tone="fg-3" numberOfLines={1}>
        {hunkLabel(hunk)}
      </Text>
    </View>
  );
}

export const DiffRowView = React.memo(function DiffRowView({ row, onPress }: { row: DiffRow; onPress?: (row: DiffRow) => void }): React.ReactElement {
  const { fontSize, wrap } = useDiffPrefs();
  return (
    <CodeLine
      text={row.content}
      kind={row.kind}
      {...(row.oldNumber !== undefined ? { oldNumber: row.oldNumber } : {})}
      {...(row.newNumber !== undefined ? { newNumber: row.newNumber } : {})}
      gutterWidth={gutterWidthFor(GUTTER_DIGITS, fontSize)}
      fontSize={fontSize}
      wrap={wrap}
      {...(onPress ? { onLongPress: () => onPress(row) } : {})}
    />
  );
});

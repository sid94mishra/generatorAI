// ────────────────────────────────────────────────────────────────
// InlineDiff — a file-op's hunks, rendered in the row.
//
// Capped at 160 lines (plan §7.2): beyond that the row points at the
// Changes pane, which is virtualised and can take the whole file. Drawn
// with the same `DiffRowView` the Changes pane uses so the two surfaces
// agree on colour and gutter (D20).
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { usePagerInnerScroll } from '../../ui/Pager';
import type { DiffRow, ToolFileOp, ToolFileOpHunk } from '@generatorai/client-core';

import { DiffRowView } from '../../diff/DiffRowView';
import { Button } from '../../ui/Button';

export const MAX_INLINE_LINES = 160;

interface Line {
  key: string;
  row: DiffRow;
}

/** Hunk lines (with their leading marker) → numbered diff rows. */
export function hunkRows(hunks: readonly ToolFileOpHunk[], cap = MAX_INLINE_LINES): { lines: Line[]; total: number } {
  const lines: Line[] = [];
  let total = 0;
  hunks.forEach((hunk, hi) => {
    let oldN = hunk.oldStart;
    let newN = hunk.newStart;
    hunk.lines.forEach((raw, li) => {
      total += 1;
      if (lines.length >= cap) return;
      const marker = raw[0];
      const content = raw.slice(1);
      let row: DiffRow;
      if (marker === '+') {
        row = { kind: 'add', newNumber: newN, content };
        newN += 1;
      } else if (marker === '-') {
        row = { kind: 'del', oldNumber: oldN, content };
        oldN += 1;
      } else {
        row = { kind: 'context', oldNumber: oldN, newNumber: newN, content };
        oldN += 1;
        newN += 1;
      }
      lines.push({ key: `h${hi}l${li}`, row });
    });
  });
  return { lines, total };
}

export function InlineDiff({
  fileOp,
  onOpenFull,
}: {
  fileOp: ToolFileOp;
  onOpenFull?: (() => void) | undefined;
}): React.ReactElement {
  const { lines, total } = useMemo(() => hunkRows(fileOp.hunks ?? []), [fileOp.hunks]);
  const clipped = total > lines.length || fileOp.hunksTruncated === true;
  // Inside the session pager: a sideways drag on a wide diff scrolls the
  // diff instead of switching panes.
  const inner = usePagerInnerScroll();

  if (lines.length === 0) {
    return (
      <View className="gap-2 px-3 py-2.5">
        <Text className="text-xs text-muted-foreground">
          {fileOp.kind === 'delete'
            ? 'File deleted.'
            : `No inline preview for this ${fileOp.kind === 'create' ? 'new file' : 'change'}.`}
        </Text>
        {onOpenFull ? <Button label="Open in Changes" variant="secondary" size="sm" onPress={onOpenFull} /> : null}
      </View>
    );
  }

  return (
    <View className="gap-2 pb-2.5">
      {/* Horizontal scroll rather than wrapping: a wrapped diff loses the
          alignment that makes it scannable. */}
      <GestureDetector gesture={inner.gesture}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onLayout={inner.onLayout}
          onContentSizeChange={inner.onContentSizeChange}
        >
          <View style={{ minWidth: '100%' }}>
            {lines.map(({ key, row }) => (
              <DiffRowView key={key} row={row} />
            ))}
          </View>
        </ScrollView>
      </GestureDetector>
      {clipped || onOpenFull ? (
        <View className="flex-row items-center justify-between gap-2 px-3">
          <Text className="flex-1 text-xs text-muted-foreground">
            {total > lines.length
              ? `Showing ${lines.length} of ${total} lines.`
              : clipped
                ? 'Preview truncated by the server.'
                : ''}
          </Text>
          {onOpenFull ? <Button label="Open full diff" variant="secondary" size="sm" onPress={onOpenFull} /> : null}
        </View>
      ) : null}
    </View>
  );
}

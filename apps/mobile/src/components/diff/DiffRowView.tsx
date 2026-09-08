// ────────────────────────────────────────────────────────────────
// Diff row renderer — compatibility surface over the shared DiffLine.
//
// The timeline's InlineDiff draws tool-call hunks with this. It used to be
// a second renderer with its own gutter and colours (D20); it is now a
// thin wrapper over `changes/DiffLine`, reading the same wrap and font
// preferences, so a hunk in the transcript looks exactly like the same
// hunk in the Changes pane.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { DiffHunk, DiffRow } from '@generatorai/client-core';

import { DiffLine } from '../changes/DiffLine';
import { HunkHeader } from '../changes/HunkHeader';
import { useDiffPrefs } from '../changes/diffPrefs';
import { gutterWidthFor, hunkLabel } from '../changes/diffModel';

/** Gutter sized for 5 digits — beyond that the file is not phone-reviewable. */
const GUTTER_DIGITS = 99_999;

export function DiffHunkHeader({ hunk }: { hunk: DiffHunk }): React.ReactElement {
  const { fontSize } = useDiffPrefs();
  return (
    <HunkHeader
      row={{ type: 'hunk', key: 'h', hunkIndex: 0, hunk, label: hunkLabel(hunk), collapsed: false, hiddenCount: 0 }}
      fontSize={fontSize}
    />
  );
}

export const DiffRowView = React.memo(function DiffRowView({
  row,
  onPress,
}: {
  row: DiffRow;
  onPress?: (row: DiffRow) => void;
}): React.ReactElement {
  const { fontSize, wrap } = useDiffPrefs();
  return (
    <DiffLine
      row={row}
      fontSize={fontSize}
      wrap={wrap}
      gutter={gutterWidthFor(GUTTER_DIGITS, fontSize)}
      language={null}
      {...(onPress ? { onLongPress: onPress } : {})}
    />
  );
});

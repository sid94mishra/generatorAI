// MB-01 ChangesStrip (MChatNoAgent; MDF-51): above the composer when the chat's last turn left changes to review —
// `changes` glyph, "N files changed", DiffStat, "Review". The whole strip (`changes-tray-toggle`) and its "Review"
// (`changes-tray-review`) open the pane on Changes. Kept files do not count; nothing renders without changes.
import React from 'react';
import { View } from 'react-native';
import type { ChangeSummary } from '@generatorai/client-core';

import { DiffStat } from '../../ui/primitives/DiffStat';
import { Icon } from '../../ui/primitives/Icon';
import { Link } from '../../ui/primitives/Link';
import { Pressable } from '../../ui/primitives/Pressable';
import { Text } from '../../ui/primitives/Text';
import { changeRows } from './model/changeKinds';

export interface ChangesStripProps {
  summary: ChangeSummary | undefined;
  onReview: () => void;
}

/** The unkept files and their lines (null when there is nothing to review). */
export function stripFacts(summary: ChangeSummary | undefined): { files: number; additions: number; deletions: number } | null {
  const rows = changeRows(summary).filter((r) => !r.kept);
  if (rows.length === 0) return null;
  return { files: rows.length, additions: rows.reduce((n, r) => n + r.additions, 0), deletions: rows.reduce((n, r) => n + r.deletions, 0) };
}

export function ChangesStrip({ summary, onReview }: ChangesStripProps): React.ReactElement | null {
  const facts = stripFacts(summary);
  if (!facts) return null;
  const label = `${facts.files} ${facts.files === 1 ? 'file' : 'files'} changed`;
  return (
    <Pressable testID="changes-tray-toggle" frame="none" onPress={onReview} accessibilityRole="button" accessibilityLabel={`${label}, ${facts.additions} added, ${facts.deletions} removed. Review`} className="mx-3 mt-2 min-h-control flex-row items-center gap-2 rounded-card bg-raised px-3">
      <Icon concept="changes" size={16} tone="fg-2" />
      <Text role="footnote" weight={500}>
        {label}
      </Text>
      <DiffStat additions={facts.additions} deletions={facts.deletions} />
      <View className="flex-1" />
      <Link label="Review" onPress={onReview} testID="changes-tray-review" />
    </Pressable>
  );
}

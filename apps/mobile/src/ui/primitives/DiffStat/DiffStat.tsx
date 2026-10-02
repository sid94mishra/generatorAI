// MP-51 DiffStat (03 MP-51): mono "+N −N · N files"; "—" when the counts are unknown (D-36).
import React from 'react';

import { Text } from '../Text';
import type { DiffStatProps } from './DiffStat.types';

export type { DiffStatProps } from './DiffStat.types';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function diffStatLabel({ additions, deletions, files }: DiffStatProps): string {
  const parts: string[] = [];
  if (additions === undefined && deletions === undefined) parts.push('Changes unknown');
  else parts.push(`${plural(additions ?? 0, 'line')} added, ${deletions ?? 0} removed`);
  if (files !== undefined) parts.push(plural(files, 'file'));
  return parts.join(', ');
}

export function DiffStat({ additions, deletions, files, testID }: DiffStatProps): React.ReactElement {
  const unknown = additions === undefined && deletions === undefined;
  return (
    <Text role="monoSm" tone="fg-3" testID={testID} accessibilityLabel={diffStatLabel({ additions, deletions, files })}>
      {unknown ? (
        '—'
      ) : (
        <>
          <Text role="monoSm" tone="ok">{`+${additions ?? 0}`}</Text>{' '}
          <Text role="monoSm" tone="err">{`\u2212${deletions ?? 0}`}</Text>
        </>
      )}
      {files === undefined ? '' : ` · ${plural(files, 'file')}`}
    </Text>
  );
}

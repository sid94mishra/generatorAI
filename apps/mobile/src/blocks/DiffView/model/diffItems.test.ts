import { describe, expect, it } from 'vitest';
import type { ReviewThread } from '@generatorai/client-core';

import { diffItems, fileNeighbours, openThreadCounts } from './diffItems';
import { buildRows, parsePatch } from './diffModel';

const PATCH = ['@@ -1,2 +1,2 @@', ' a', '-b', '+c'].join('\n');
const thread = (id: string, side: 'additions' | 'deletions', endLine: number, status = 'pending'): ReviewThread =>
  ({ id, side, endLine, startLine: endLine, status, comments: [], repoAlias: '.', path: 'x', workspaceId: 'w', anchorText: '', reviewRound: 1, baseCheckpointId: '', headCheckpointId: '' }) as ReviewThread;

describe('diff items (MB-24, MD-61)', () => {
  it('draws threads after their anchor line, the composer after the selected line, strays at the end', () => {
    const rows = buildRows(parsePatch(PATCH));
    const items = diffItems(rows, [thread('t1', 'additions', 2), thread('t2', 'additions', 99)], { side: 'additions', line: 2 });
    expect(items.map((i) => (i.type === 'line' ? `${i.row.kind}` : i.type === 'thread' ? i.thread.id : i.type))).toEqual(['hunk', 'context', 'del', 'add', 't1', 'composer', 't2']);
  });

  it('counts only open threads per line', () => {
    const counts = openThreadCounts([thread('a', 'additions', 2), thread('b', 'additions', 2, 'resolved'), thread('c', 'deletions', 2)]);
    expect([...counts]).toEqual([
      ['additions:2', 1],
      ['deletions:2', 1],
    ]);
  });

  it('finds the previous and next file', () => {
    const files = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(fileNeighbours(files, 'b')).toEqual({ index: 1, total: 3, prev: { id: 'a' }, next: { id: 'c' } });
    expect(fileNeighbours(files, 'a').prev).toBeNull();
    expect(fileNeighbours(files, 'z')).toMatchObject({ index: -1, next: null });
  });
});

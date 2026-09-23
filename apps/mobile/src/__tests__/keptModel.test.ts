import { describe, expect, it } from 'vitest';

import { keepRef, keptLabel, splitKept, undoAllMessage } from '../components/changes/keptModel';

const file = (path: string, extra: Record<string, unknown> = {}) => ({
  alias: '.',
  path,
  status: 'modified',
  newBlob: `blob-${path}`,
  ...extra,
});

describe('splitKept', () => {
  it('moves kept files out of the review list and keeps order', () => {
    const { pending, kept } = splitKept([file('a'), file('b', { kept: true }), file('c'), file('d', { kept: true })]);
    expect(pending.map((f) => f.path)).toEqual(['a', 'c']);
    expect(kept.map((f) => f.path)).toEqual(['b', 'd']);
  });

  it('treats a missing flag as not kept', () => {
    expect(splitKept([file('a', { kept: undefined }), file('b', { kept: false })]).kept).toEqual([]);
  });
});

describe('keepRef', () => {
  it('pins the keep to the content the reader saw', () => {
    expect(keepRef(file('src/x.ts', { alias: 'api' }))).toEqual({ alias: 'api', path: 'src/x.ts', blob: 'blob-src/x.ts' });
  });

  it('keeps a deletion as the empty blob', () => {
    expect(keepRef(file('gone.ts', { status: 'deleted', newBlob: undefined })).blob).toBe('');
  });
});

describe('copy', () => {
  it('labels the group and warns precisely before Undo all', () => {
    expect(keptLabel(3)).toBe('3 kept');
    expect(undoAllMessage(1, 0)).toContain('1 file ');
    expect(undoAllMessage(2, 1)).toContain('3 files');
    expect(undoAllMessage(2, 1)).toContain('including the ones you kept');
    expect(undoAllMessage(2, 0)).not.toContain('kept');
  });
});

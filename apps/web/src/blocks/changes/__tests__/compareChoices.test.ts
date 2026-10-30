import { describe, expect, it } from 'vitest';
import type { CheckpointGroup } from '../checkpoints/checkpointGroups.js';
import { compareChoices, effectiveCompareBase, undoTargetOf } from '../compareChoices.js';

function turn(id: string, createdAt: string): CheckpointGroup {
  return {
    key: `turn:${id}`,
    turnId: id,
    kind: 'turn',
    label: undefined,
    createdAt,
    promptExcerpt: undefined,
    aliases: ['.'],
    restoreTargets: [],
    undoesTurn: true,
    fileCount: 1,
    additions: 1,
    deletions: 0,
    compareValue: `turn:${id}`,
  } as CheckpointGroup;
}

const time = (iso: string) => iso.slice(11, 16);
const TURNS = [turn('t2', '2026-10-24T10:05:00Z'), turn('t1', '2026-10-24T10:00:00Z')];

describe('compareChoices', () => {
  it('offers Uncommitted, This chat and Last turn — the newest turn, whatever the order', () => {
    const options = compareChoices({ base: 'head', hasGit: true, scope: 'chat', groups: TURNS, formatTime: time });
    expect(options.map((o) => [o.value, o.label])).toEqual([
      ['head', 'Uncommitted changes'],
      ['baseline', 'This chat'],
      ['turn:t2', 'Last turn'],
    ]);
  });

  it('drops Uncommitted without git and Last turn before any turn; a run says This run', () => {
    const options = compareChoices({ base: 'head', hasGit: false, scope: 'run', groups: [], formatTime: time });
    expect(options.map((o) => o.label)).toEqual(['This run']);
    expect(effectiveCompareBase('head', false)).toBe('baseline');
  });

  it('labels an older turn picked on the timeline by its number', () => {
    const options = compareChoices({ base: 'turn:t1', hasGit: true, scope: 'chat', groups: TURNS, formatTime: time });
    expect(options.at(-1)).toEqual({ value: 'turn:t1', label: 'Since turn 1', meta: '10:00' });
    expect(undoTargetOf('turn:t1', options, 'chat')).toBe('to how it was before turn 1');
  });

  it('says where Undo puts files back for each base', () => {
    const options = compareChoices({ base: 'head', hasGit: true, scope: 'chat', groups: TURNS, formatTime: time });
    expect(undoTargetOf('head', options, 'chat')).toBe('to the last commit');
    expect(undoTargetOf('baseline', options, 'chat')).toBe('to how it was when this chat started');
    expect(undoTargetOf('turn:t2', options, 'chat')).toBe('to how it was before the last turn');
  });
});

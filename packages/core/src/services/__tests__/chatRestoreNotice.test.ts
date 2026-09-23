// What the agent is told after the user moves files back in time.
//
// Observed live: a user rewound a review round from the Changes tab, then
// asked for an unrelated change. The agent found its earlier edits missing,
// concluded "the working tree had been rolled back", and re-applied them —
// the rewind was undone by the very next turn, and said so only in passing.

import { describe, it, expect } from 'vitest';
import { ChatManagementService } from '../ChatManagementService.js';

type Internals = {
  noteUserRestore: (chatId: string, n: { repoAlias: string; restoredPaths: string[]; deletedPaths: string[] }) => void;
  drainRestoreNotice: (chatId: string) => string;
};

function service(): Internals {
  const none = {} as never;
  return new ChatManagementService(none, none, none, none, none) as unknown as Internals;
}

describe('restore notice for the next prompt', () => {
  it('names the files, says it was deliberate, and tells the agent not to put them back', () => {
    const s = service();
    s.noteUserRestore('c1', { repoAlias: 'shopkit', restoredPaths: ['src/orders/refunds.js'], deletedPaths: ['test/refunds.test.js'] });
    const notice = s.drainRestoreNotice('c1');
    expect(notice).toContain('shopkit: src/orders/refunds.js, test/refunds.test.js');
    expect(notice).toContain('on purpose');
    expect(notice).toMatch(/do NOT re-apply/);
    expect(notice.endsWith('\n\n')).toBe(true); // sits cleanly in front of the prompt
  });

  it('is said once', () => {
    const s = service();
    s.noteUserRestore('c1', { repoAlias: 'a', restoredPaths: ['x.js'], deletedPaths: [] });
    expect(s.drainRestoreNotice('c1')).not.toBe('');
    expect(s.drainRestoreNotice('c1')).toBe('');
  });

  it('merges several undos before the next prompt and keeps chats apart', () => {
    const s = service();
    s.noteUserRestore('c1', { repoAlias: 'a', restoredPaths: ['x.js'], deletedPaths: [] });
    s.noteUserRestore('c1', { repoAlias: 'a', restoredPaths: ['x.js', 'y.js'], deletedPaths: [] });
    s.noteUserRestore('c2', { repoAlias: 'b', restoredPaths: ['z.js'], deletedPaths: [] });
    const one = s.drainRestoreNotice('c1');
    expect(one).toContain('a: x.js, y.js');
    expect(one).not.toContain('z.js');
    expect(s.drainRestoreNotice('c2')).toContain('b: z.js');
  });

  it('caps a very long list instead of spending the context on it', () => {
    const s = service();
    const many = Array.from({ length: 40 }, (_, i) => `f${String(i).padStart(2, '0')}.js`);
    s.noteUserRestore('c1', { repoAlias: 'a', restoredPaths: many, deletedPaths: [] });
    const notice = s.drainRestoreNotice('c1');
    expect(notice).toContain('(+28 more)');
    expect(notice).not.toContain('f39.js');
  });

  it('says nothing when nothing was restored', () => {
    expect(service().drainRestoreNotice('nobody')).toBe('');
  });
});

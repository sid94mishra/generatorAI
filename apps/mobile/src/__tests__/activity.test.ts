import { describe, expect, it } from 'vitest';

import type { ChatSummary, InteractionSummary } from '@generatorai/client-core';

import {
  GATE_PROBE_LIMIT,
  filterOperations,
  hasPendingGate,
  rankOperations,
  selectGateCandidates,
  type Operation,
} from '../api/activityRanking';
import { crumbsFor, levelEntries } from '../components/chat/workbench/fileTree';

function op(partial: Partial<Operation> & Pick<Operation, 'id' | 'updatedAt'>): Operation {
  return {
    kind: 'run',
    name: partial.id,
    status: 'completed',
    href: '/',
    blocked: false,
    running: false,
    ...partial,
  };
}

describe('rankOperations', () => {
  it('puts blocked work first even when it is the oldest', () => {
    // The entire reason to open this app on a phone.
    const ranked = rankOperations([
      op({ id: 'fresh', updatedAt: 1000 }),
      op({ id: 'blocked', updatedAt: 1, blocked: true }),
      op({ id: 'running', updatedAt: 500, running: true }),
    ]);
    expect(ranked.map((o) => o.id)).toEqual(['blocked', 'running', 'fresh']);
  });

  it('falls back to newest-first among peers', () => {
    const ranked = rankOperations([op({ id: 'old', updatedAt: 1 }), op({ id: 'new', updatedAt: 2 })]);
    expect(ranked.map((o) => o.id)).toEqual(['new', 'old']);
  });

  it('does not mutate its input', () => {
    const input = [op({ id: 'a', updatedAt: 1 }), op({ id: 'b', updatedAt: 2 })];
    rankOperations(input);
    expect(input.map((o) => o.id)).toEqual(['a', 'b']);
  });
});

describe('filterOperations', () => {
  const now = 1_000_000_000;
  const list = [
    op({ id: 'blocked', updatedAt: now - 1000, blocked: true }),
    op({ id: 'running', updatedAt: now - 2000, running: true }),
    op({ id: 'yesterday', updatedAt: now - 25 * 60 * 60 * 1000 }),
  ];

  it('"today" means the last 24 hours, not since midnight', () => {
    // Someone checking at 00:30 wants last night's work, not an empty list.
    expect(filterOperations(list, 'today', now).map((o) => o.id)).toEqual(['blocked', 'running']);
  });

  it('"running" only includes in-flight work', () => {
    expect(filterOperations(list, 'running', now).map((o) => o.id)).toEqual(['running']);
  });

  it('"attention" only includes blocked work', () => {
    expect(filterOperations(list, 'attention', now).map((o) => o.id)).toEqual(['blocked']);
  });
});

describe('levelEntries', () => {
  const paths = [
    'README.md',
    'src/index.ts',
    'src/components/Button.tsx',
    'src/components/Chip.tsx',
  ];

  it('lists directories before files at the root', () => {
    expect(levelEntries(paths, '')).toEqual([
      { name: 'src', path: 'src/', isDir: true, count: 3 },
      { name: 'README.md', path: 'README.md', isDir: false },
    ]);
  });

  it('descends into a prefix without repeating it', () => {
    expect(levelEntries(paths, 'src/')).toEqual([
      { name: 'components', path: 'src/components/', isDir: true, count: 2 },
      { name: 'index.ts', path: 'src/index.ts', isDir: false },
    ]);
  });

  it('keeps the full path on file entries so they can be opened', () => {
    const entries = levelEntries(paths, 'src/components/');
    expect(entries.map((e) => e.path)).toEqual([
      'src/components/Button.tsx',
      'src/components/Chip.tsx',
    ]);
  });

  it('is empty for a prefix that matches nothing', () => {
    expect(levelEntries(paths, 'nope/')).toEqual([]);
  });

  it('does not emit an entry for the prefix itself', () => {
    // A path equal to the prefix would otherwise yield a nameless row.
    expect(levelEntries(['src/', 'src/a.ts'], 'src/')).toEqual([
      { name: 'a.ts', path: 'src/a.ts', isDir: false },
    ]);
  });
});

describe('crumbsFor', () => {
  it('is empty at the root', () => {
    expect(crumbsFor('')).toEqual([]);
  });

  it('drops the trailing slash', () => {
    expect(crumbsFor('src/components/')).toEqual(['src', 'components']);
  });
});

function chat(id: string, updatedAt: string, status = 'active'): ChatSummary {
  return { id, name: id, sessionId: null, status, createdAt: updatedAt, updatedAt };
}

describe('selectGateCandidates', () => {
  // D10 — the pending-gate source is per chat, so the feed probes a bounded,
  // ordered set rather than every chat on every refresh.
  it('probes running chats first, then the most recently updated', () => {
    const picked = selectGateCandidates(
      [
        chat('stale', '2026-09-01T00:00:00Z'),
        chat('fresh', '2026-09-06T00:00:00Z'),
        chat('running-old', '2026-08-01T00:00:00Z'),
      ],
      ['running-old'],
    );
    expect(picked).toEqual(['running-old', 'fresh', 'stale']);
  });

  it('skips archived chats', () => {
    const picked = selectGateCandidates(
      [chat('archived', '2026-09-06T00:00:00Z', 'archived'), chat('live', '2026-09-01T00:00:00Z')],
      [],
    );
    expect(picked).toEqual(['live']);
  });

  it('caps the probe set', () => {
    const many = Array.from({ length: GATE_PROBE_LIMIT + 5 }, (_, i) =>
      chat(`c${i}`, new Date(1_700_000_000_000 + i * 1000).toISOString()),
    );
    expect(selectGateCandidates(many, [])).toHaveLength(GATE_PROBE_LIMIT);
    expect(selectGateCandidates(many, [], 3)).toHaveLength(3);
    // A running chat outside the recency window still makes the cut.
    expect(selectGateCandidates(many, ['c0'], 3)[0]).toBe('c0');
  });
});

describe('hasPendingGate', () => {
  const pending: InteractionSummary = { interactionId: 'i1', kind: 'tool_permission', status: 'pending' };
  const answered: InteractionSummary = { interactionId: 'i2', kind: 'question', status: 'answered' };

  it('is true only for a pending interaction of any kind', () => {
    expect(hasPendingGate([pending])).toBe(true);
    expect(hasPendingGate([{ ...pending, kind: 'plan_review' }])).toBe(true);
    expect(hasPendingGate([answered])).toBe(false);
  });

  it('is false while the probe has not answered', () => {
    expect(hasPendingGate(undefined)).toBe(false);
    expect(hasPendingGate([])).toBe(false);
  });
});

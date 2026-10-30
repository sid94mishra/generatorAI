// U-39: opening a chat reads its latest turn and only the earlier rows the transcript still needs.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDB, migrateDB } from '../src/index.js';
import { DrizzleStreamCursorRepository } from '../src/repositories/StreamCursorRepository.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'gai-prelude-'));
  dirs.push(dir);
  const db = createDB(join(dir, 'p.db'));
  migrateDB(db);
  return new DrizzleStreamCursorRepository(db);
}

const opts = {
  turnKind: 'harness.user_message',
  isTurnStart: (p: unknown) => !(p as { __isInternalTurn?: boolean }).__isInternalTurn,
  keepPrefixes: ['harness.widget.', 'chat.'],
  latestKinds: ['harness.usage'],
  latestCount: 2,
};

describe('turnPrelude (U-39)', () => {
  it('starts at the latest real turn and keeps only the listed kinds before it', async () => {
    const r = repo();
    const add = (kind: string, payload: Record<string, unknown> = {}) => r.append('chat', 'c1', kind, payload);
    await add('harness.user_message'); // 1
    await add('harness.token'); // 2
    await add('harness.widget.rendered'); // 3
    await add('harness.usage', { n: 1 }); // 4
    await add('harness.usage', { n: 2 }); // 5
    await add('harness.usage', { n: 3 }); // 6
    await add('chatX.not_a_prefix_match'); // 7 — `chat.` is a prefix, not a pattern
    await add('chat.background_task.progress'); // 8
    await add('harness.user_message'); // 9 — the latest real turn
    await add('harness.token'); // 10
    await add('harness.user_message', { __isInternalTurn: true }); // 11 — a summary turn does not start a turn
    await r.append('chat', 'other', 'harness.widget.rendered', {}); // another chat

    const { turnStartSeq, rows } = await r.turnPrelude('chat', 'c1', opts);
    expect(turnStartSeq).toBe(9);
    expect(rows.map((x) => x.seq)).toEqual([3, 5, 6, 8]);
  });

  it('replays everything when the chat has no earlier turn', async () => {
    const r = repo();
    await r.append('chat', 'c2', 'harness.user_message', {});
    await r.append('chat', 'c2', 'harness.token', {});
    expect(await r.turnPrelude('chat', 'c2', opts)).toEqual({ turnStartSeq: 0, rows: [] });
    expect(await r.turnPrelude('chat', 'none', opts)).toEqual({ turnStartSeq: 0, rows: [] });
  });
});

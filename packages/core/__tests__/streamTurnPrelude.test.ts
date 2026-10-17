// U-39 follow-up — a chat that is one long turn opens from one prelude response: the latest turn comes inline
// with its streaming deltas folded, and paging resumes past it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDB, migrateDB, DrizzleStreamCursorRepository, type StreamEventRow } from '@generatorai/db';
import type { ILogger } from '@generatorai/shared';

import { StreamBroker } from '../src/services/StreamBroker.js';
import { foldTurnRows } from '../src/services/streamTurnFold.js';

const row = (seq: number, kind: string, payload: Record<string, unknown>): StreamEventRow => ({
  id: seq, scope: 'chat', scopeId: 'c', seq, kind, payload, ts: seq,
});

describe('foldTurnRows', () => {
  it('folds each run of same-stream deltas into its last row, keeping order around everything else', () => {
    const folded = foldTurnRows([
      row(1, 'harness.user_message', { content: 'go' }),
      row(2, 'harness.reasoning_delta', { text: 'th' }),
      row(3, 'harness.reasoning_delta', { text: 'ink' }),
      row(4, 'harness.token', { text: 'Hel' }),
      row(5, 'harness.session_info', { infoType: 'tool_input_delta', message: '{"pa' }),
      row(6, 'harness.token', { text: 'lo' }),
      row(7, 'harness.tool_start', { tool: 'Read' }),
      row(8, 'harness.token', { text: 'a', stageRunId: 's1' }),
      row(9, 'harness.token', { text: 'b', stageRunId: 's2' }),
      row(10, 'harness.idle', {}),
    ]);
    expect(folded.map((r) => [r.seq, r.kind, (r.payload as { text?: string }).text])).toEqual([
      [1, 'harness.user_message', undefined],
      [3, 'harness.reasoning_delta', 'think'],
      [6, 'harness.token', 'Hello'], // the tool-input delta between them is dropped, not a run break
      [7, 'harness.tool_start', undefined],
      [8, 'harness.token', 'a'], // another stream's delta is never merged into this one
      [9, 'harness.token', 'b'],
      [10, 'harness.idle', undefined],
    ]);
  });
});

describe('StreamBroker.chatTurnPrelude', () => {
  let dir: string;
  let broker: StreamBroker;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gai-prelude-'));
    const db = createDB(join(dir, 'p.db'));
    migrateDB(db);
    broker = new StreamBroker(new DrizzleStreamCursorRepository(db), { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ILogger, { deltaBatchMs: 0 });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('inlines a long latest turn folded, and resumes paging after it', async () => {
    await broker.publish('chat', 'c', 'harness.user_message', { content: 'first' });
    await broker.publish('chat', 'c', 'harness.token', { text: 'old answer' });
    await broker.publish('chat', 'c', 'harness.idle', {});
    await broker.publish('chat', 'c', 'harness.user_message', { content: 'work for a long time' });
    for (let i = 0; i < 1_200; i++) await broker.publish('chat', 'c', 'harness.token', { text: 'x' });
    await broker.publish('chat', 'c', 'harness.message_complete', { content: 'x'.repeat(1_200) });
    await broker.publish('chat', 'c', 'harness.idle', {});
    await broker.flushWrites();

    const { turnStartSeq, rows } = await broker.chatTurnPrelude('c');
    expect(rows.map((r) => r.kind)).toEqual(['harness.user_message', 'harness.token', 'harness.message_complete', 'harness.idle']);
    expect((rows[1]!.payload as { text: string }).text).toHaveLength(1_200);
    const tip = rows[rows.length - 1]!.seq;
    expect(turnStartSeq).toBe(tip + 1);
    expect(await broker.replay('chat', 'c', turnStartSeq - 1, 500)).toEqual([]);
  });

  it('treats a chat whose only turn starts at the first row as one turn', async () => {
    await broker.publish('chat', 'c', 'harness.user_message', { content: 'worker task' });
    await broker.publish('chat', 'c', 'harness.token', { text: 'do' });
    await broker.publish('chat', 'c', 'harness.token', { text: 'ne' });
    await broker.flushWrites();
    const { turnStartSeq, rows } = await broker.chatTurnPrelude('c');
    expect(rows.map((r) => (r.payload as { text?: string }).text ?? r.kind)).toEqual(['harness.user_message', 'done']);
    expect(turnStartSeq).toBe(rows[1]!.seq + 1);
  });
});

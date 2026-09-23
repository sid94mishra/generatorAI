import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@generatorai/client-core';

import type { ReplayPage, ReplayRow } from '../components/scm/scmResults';
import { stageCatchUpRows, turnCatchUpRows, unansweredTurnId } from '../stream/turnCatchUp';

function msg(role: ChatMessage['role'], turnId?: string): ChatMessage {
  return { id: `${role}-${turnId}`, chatId: 'c', role, content: 'x', ...(turnId ? { metadata: { turnId } } : {}) };
}

function pager(rows: ReplayRow[], pageSize: number) {
  const calls: number[] = [];
  const replay = async (afterSeq: number): Promise<ReplayPage> => {
    calls.push(afterSeq);
    const page = rows.filter((r) => r.seq > afterSeq).slice(0, pageSize);
    return { rows: page, nextAfterSeq: page.length ? page[page.length - 1]!.seq : afterSeq };
  };
  return { replay, calls };
}

describe('unansweredTurnId', () => {
  it('is the last prompt when nothing answered it', () => {
    expect(unansweredTurnId([msg('user', 't1'), msg('assistant', 't1'), msg('user', 't2')])).toBe('t2');
  });

  it('is null once the turn has an answer, or for an empty chat', () => {
    expect(unansweredTurnId([msg('user', 't1'), msg('assistant', 't1')])).toBeNull();
    expect(unansweredTurnId([])).toBeNull();
    expect(unansweredTurnId(undefined)).toBeNull();
    expect(unansweredTurnId([msg('user')])).toBeNull();
  });
});

describe('turnCatchUpRows', () => {
  const rows: ReplayRow[] = [
    { seq: 1, kind: 'harness.turn_start', payload: { turnId: 't1' } },
    { seq: 2, kind: 'harness.turn_end', payload: { turnId: 'provider-sub-turn' } },
    { seq: 3, kind: 'harness.idle', payload: {} },
    { seq: 4, kind: 'chat.plan.drafting', payload: { turnId: 't2' } },
    { seq: 5, kind: 'harness.turn_start', payload: { turnId: 't2' } },
    { seq: 6, kind: 'harness.token', payload: { text: 'hi' } },
  ];

  it('keeps every row from the first one that names the turn, across pages', async () => {
    const result = await turnCatchUpRows(pager(rows, 2).replay, 't2', { pageSize: 2 });
    expect(result?.rows.map((r) => r.seq)).toEqual([4, 5, 6]);
    expect(result?.lastSeq).toBe(6);
  });

  it('reads past the turn to the end of the log', async () => {
    const result = await turnCatchUpRows(pager(rows, 500).replay, 't1');
    expect(result?.rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('is null when the log never mentions the turn', async () => {
    const { replay, calls } = pager(rows, 2);
    expect(await turnCatchUpRows(replay, 'missing', { pageSize: 2 })).toBeNull();
    expect(calls).toEqual([0, 2, 4, 6]);
  });

  it('gives up after the page cap instead of walking forever', async () => {
    const { replay, calls } = pager(rows, 1);
    expect(await turnCatchUpRows(replay, 't2', { pageSize: 1, maxPages: 2 })).toBeNull();
    expect(calls).toHaveLength(2);
  });
});

describe('stageCatchUpRows', () => {
  const rows: ReplayRow[] = [
    { seq: 1, kind: 'workflow_run.running', payload: {} },
    { seq: 2, kind: 'harness.tool_start', payload: { stageRunId: 's1' } },
    { seq: 3, kind: 'harness.tool_start', payload: { stageRunId: 's2' } },
    { seq: 4, kind: 'harness.token', payload: { stageRunId: 's1', text: 'x' } },
    { seq: 5, kind: 'stage_run.running', payload: {} },
  ];

  it("keeps only the stage's own rows and reads to the end of the log", async () => {
    const result = await stageCatchUpRows(pager(rows, 2).replay, 's1', { pageSize: 2 });
    expect(result?.rows.map((r) => r.seq)).toEqual([2, 4]);
    expect(result?.lastSeq).toBe(5);
  });

  it('is empty, not null, for a stage that has logged nothing yet', async () => {
    expect(await stageCatchUpRows(pager(rows, 500).replay, 's9')).toEqual({ rows: [], lastSeq: 5 });
  });
});

import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@generatorai/client-core';

import { withLiveRows, type TranscriptItem } from '../components/runs/stageTranscript';
import type { TimelineRow } from '../components/chat/timeline/deriveTimeline';

const user = (id: string): TranscriptItem => ({
  kind: 'user',
  id,
  message: { id, chatId: 'c', role: 'user', content: id } as ChatMessage,
});
const row = (id: string): TimelineRow => ({ id }) as unknown as TimelineRow;
const saved = (id: string): TranscriptItem => ({ kind: 'row', id, row: row(id) });

describe('withLiveRows', () => {
  it('puts the live turn after the latest prompt', () => {
    const items = withLiveRows([user('p1'), saved('a1'), user('p2')], [row('l1'), row('l2')]);
    expect(items.map((i) => i.id)).toEqual(['p1', 'a1', 'p2', 'l1', 'l2']);
  });

  it('leaves the saved transcript alone while nothing streams', () => {
    const items = [user('p1'), saved('a1')];
    expect(withLiveRows(items, [])).toBe(items);
  });

  it('drops saved rows after the latest prompt in favour of the live ones', () => {
    expect(withLiveRows([user('p1'), saved('stale')], [row('l1')]).map((i) => i.id)).toEqual(['p1', 'l1']);
  });
});

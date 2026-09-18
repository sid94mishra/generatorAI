import { describe, expect, it } from 'vitest';

import { transcriptItems } from '../components/runs/stageTranscript';

const base = { chatId: 'c1', sessionId: 's1' };

describe('transcriptItems', () => {
  it('renders user prompts and assistant prose in time order', () => {
    const items = transcriptItems(
      [
        { ...base, id: 'a1', role: 'assistant', content: 'Done.', createdAt: '2026-01-01T00:00:02Z' },
        { ...base, id: 'u1', role: 'user', content: 'Do it', createdAt: '2026-01-01T00:00:01Z' },
      ],
      false,
    );
    expect(items[0]).toMatchObject({ kind: 'user', id: 'u1' });
    expect(items.slice(1).some((i) => i.kind === 'row' && i.row.kind === 'text')).toBe(true);
  });

  it('ignores malformed rows and system/tool messages', () => {
    const items = transcriptItems(
      [null, 'x', { id: 1 }, { ...base, id: 'sys', role: 'system', content: 'boot' }],
      false,
    );
    expect(items).toEqual([]);
    expect(transcriptItems({ not: 'an array' }, true)).toEqual([]);
  });

  it('prefixes row ids per message so turns never collide', () => {
    const items = transcriptItems(
      [
        { ...base, id: 'a1', role: 'assistant', content: 'One', createdAt: 1 },
        { ...base, id: 'a2', role: 'assistant', content: 'Two', createdAt: 2 },
      ],
      true,
    );
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith('a1:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('a2:'))).toBe(true);
  });
});

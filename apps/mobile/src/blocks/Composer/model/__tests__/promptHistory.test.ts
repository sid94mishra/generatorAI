import { describe, expect, it } from 'vitest';

import {
  HISTORY_LIMIT,
  caretLine,
  historyForSheet,
  mergePromptHistory,
  pushHistoryRing,
  readHistoryRing,
  stepHistory,
  writeHistoryRing,
  type HistoryStorage,
} from '../promptHistory';
import type { PromptHistoryEntry } from '../types';

function memStorage(): HistoryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getString: (k) => data.get(k),
    setString: (k, v) => void data.set(k, v),
  };
}

const e = (text: string, ts: number, id = `${text}:${ts}`): PromptHistoryEntry => ({ id, text, ts });

describe('history ring', () => {
  it('appends, trims whitespace, and holds the newest 50', () => {
    let ring: PromptHistoryEntry[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) ring = pushHistoryRing(ring, e(`p${i} `, i));
    expect(ring).toHaveLength(HISTORY_LIMIT);
    expect(ring[0]!.text).toBe('p10');
    expect(ring[ring.length - 1]!.text).toBe(`p${HISTORY_LIMIT + 9}`);
  });

  it('does not record an immediate repeat or an empty prompt', () => {
    let ring = pushHistoryRing([], e('same', 1));
    ring = pushHistoryRing(ring, e('same', 2));
    expect(ring).toHaveLength(1);
    expect(pushHistoryRing(ring, e('   ', 3))).toHaveLength(1);
  });

  it('records a prompt with attachments even when the text is empty', () => {
    const ring = pushHistoryRing([], { id: 'a', text: '', ts: 1, attachments: [{ name: 'x.png', mimeType: 'image/png' }] });
    expect(ring).toHaveLength(1);
  });

  it('round-trips through storage and tolerates garbage', () => {
    const storage = memStorage();
    writeHistoryRing(storage, [e('a', 1), e('b', 2)]);
    expect(readHistoryRing(storage).map((x) => x.text)).toEqual(['a', 'b']);
    storage.setString('composer.history', '{not json');
    expect(readHistoryRing(storage)).toEqual([]);
    storage.setString('composer.history', JSON.stringify([{ nope: 1 }, { id: 'x', text: 'ok', ts: 3 }]));
    expect(readHistoryRing(storage).map((x) => x.text)).toEqual(['ok']);
  });
});

describe('mergePromptHistory', () => {
  it('drops a local entry once the server echoes it', () => {
    const merged = mergePromptHistory([e('hi', 1000)], [e('hi', 998, 'local')]);
    expect(merged.map((x) => x.id)).toEqual(['hi:1000']);
  });

  it('keeps a local entry the server has not echoed, sorted by time', () => {
    const merged = mergePromptHistory([e('old', 100)], [e('new', 200, 'local')]);
    expect(merged.map((x) => x.text)).toEqual(['old', 'new']);
  });

  it('collapses immediate repeats', () => {
    const merged = mergePromptHistory([e('x', 1), e('x', 2), e('y', 3)], []);
    expect(merged.map((x) => x.text)).toEqual(['x', 'y']);
  });

  it('the sheet lists newest first', () => {
    expect(historyForSheet([e('a', 1), e('b', 2)]).map((x) => x.text)).toEqual(['b', 'a']);
  });
});

describe('stepHistory — shell semantics', () => {
  it('↑ from the draft recalls the newest, ↑ at the oldest does nothing', () => {
    expect(stepHistory(null, 3, -1)).toBe(2);
    expect(stepHistory(2, 3, -1)).toBe(1);
    expect(stepHistory(0, 3, -1)).toBeUndefined();
  });
  it('↓ past the newest returns to the draft; ↓ on the draft falls through', () => {
    expect(stepHistory(2, 3, 1)).toBeNull();
    expect(stepHistory(1, 3, 1)).toBe(2);
    expect(stepHistory(null, 3, 1)).toBeUndefined();
  });
  it('is inert with no history', () => {
    expect(stepHistory(null, 0, -1)).toBeUndefined();
  });
});

describe('caretLine', () => {
  it('knows the first and last lines', () => {
    expect(caretLine('one\ntwo', 1)).toEqual({ first: true, last: false });
    expect(caretLine('one\ntwo', 6)).toEqual({ first: false, last: true });
    expect(caretLine('solo', 2)).toEqual({ first: true, last: true });
  });
});

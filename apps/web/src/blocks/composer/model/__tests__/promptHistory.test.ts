import { describe, expect, it } from 'vitest';
import { caretLine, mergePromptHistory, stepHistory, type PromptHistoryEntry } from '../promptHistory.js';

const e = (id: string, text: string, ts: number, n = 0): PromptHistoryEntry => ({
  id, text, ts, attachments: Array.from({ length: n }, (_, i) => ({ name: `f${i}.png`, mimeType: 'image/png' })),
});

describe('mergePromptHistory', () => {
  it('orders oldest → newest and drops a local send once the server echoes it', () => {
    const persisted = [e('p1', 'first', 100), e('p2', 'second', 200)];
    const local = [e('l1', 'second', 199), e('l2', 'third', 300)];
    expect(mergePromptHistory(persisted, local).map((x) => x.id)).toEqual(['p1', 'p2', 'l2']);
  });

  it('collapses immediate repeats', () => {
    expect(mergePromptHistory([e('a', 'x', 1), e('b', 'x', 2), e('c', 'y', 3)], []).map((x) => x.id)).toEqual(['a', 'c']);
  });
});

describe('stepHistory', () => {
  it('walks back from the draft and forward again to the draft', () => {
    expect(stepHistory(null, 3, -1)).toBe(2);
    expect(stepHistory(2, 3, -1)).toBe(1);
    expect(stepHistory(0, 3, -1)).toBeUndefined();
    expect(stepHistory(1, 3, 1)).toBe(2);
    expect(stepHistory(2, 3, 1)).toBeNull();
    expect(stepHistory(null, 3, 1)).toBeUndefined();
    expect(stepHistory(null, 0, -1)).toBeUndefined();
  });
});

describe('caretLine', () => {
  it('reports first/last line for the caret position', () => {
    expect(caretLine('one\ntwo', 1)).toEqual({ first: true, last: false });
    expect(caretLine('one\ntwo', 6)).toEqual({ first: false, last: true });
    expect(caretLine('one', 2)).toEqual({ first: true, last: true });
    expect(caretLine('', 0)).toEqual({ first: true, last: true });
  });
});

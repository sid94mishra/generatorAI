import { describe, expect, it } from 'vitest';
import { splitKeys } from '../tui/keyPump.js';

describe('splitKeys', () => {
  it('splits a run of typed characters', () => {
    expect(splitKeys('gw')).toEqual(['g', 'w']);
  });

  it('keeps a control byte as its own key', () => {
    expect(splitKeys('\u000bworkflow')).toEqual([
      '\u000b', 'w', 'o', 'r', 'k', 'f', 'l', 'o', 'w',
    ]);
  });

  it('keeps a CSI sequence whole', () => {
    expect(splitKeys('\u001B[Aabc')).toEqual(['\u001B[A', 'a', 'b', 'c']);
  });

  it('keeps an SS3 sequence whole', () => {
    expect(splitKeys('\u001BOP')).toEqual(['\u001BOP']);
  });

  it('treats Alt+key as one key', () => {
    expect(splitKeys('\u001Bb')).toEqual(['\u001Bb']);
  });

  it('passes a lone Escape through', () => {
    expect(splitKeys('\u001B')).toEqual(['\u001B']);
  });

  it('delivers a bracketed paste as a single event', () => {
    const paste = '\u001B[200~line one\nline two\u001B[201~';
    expect(splitKeys(paste)).toEqual([paste]);
  });

  it('does not tear a surrogate pair in half', () => {
    expect(splitKeys('a🙂b')).toEqual(['a', '🙂', 'b']);
  });

  it('separates Enter from the text before it', () => {
    expect(splitKeys('hi\r')).toEqual(['h', 'i', '\r']);
  });
});

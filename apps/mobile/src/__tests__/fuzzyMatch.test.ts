import { describe, expect, it } from 'vitest';

import { fuzzyFilter, fuzzyScore } from '../lib/fuzzyMatch';

const MODELS = [
  { id: 'auto', name: 'Auto' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { id: 'claude-opus-5', name: 'Claude Opus 5' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
];

const search = (q: string): string[] =>
  fuzzyFilter(MODELS, q, (m) => [m.name, m.id]).map((m) => m.name);

describe('fuzzyMatch', () => {
  it('finds Sonnet models from the misspelling "sonet"', () => {
    // The reported bug: web's substring filter returns nothing for this.
    const hits = search('sonet');
    expect(hits).toContain('Claude Sonnet 5');
    expect(hits).toContain('Claude Sonnet 4.6');
  });

  it('ignores punctuation, so "gpt56" reaches "GPT-5.6"', () => {
    expect(search('gpt56')).toContain('GPT-5.6 Sol');
  });

  it('ranks an exact name above a looser match', () => {
    expect(search('claude opus 5')[0]).toBe('Claude Opus 5');
  });

  it('ranks a prefix hit first', () => {
    expect(search('gemini')[0]).toBe('Gemini 3.1 Pro');
  });

  it('still matches on id when the name does not contain the query', () => {
    expect(search('haiku')).toContain('Claude Haiku 4.5');
  });

  it('returns everything for a blank query, in catalog order', () => {
    expect(search('  ')).toEqual(MODELS.map((m) => m.name));
  });

  it('rejects a query whose letters are scattered too far apart', () => {
    // "aeo" appears in order across "Claude Sonnet 4.6" but nowhere near
    // each other, which is coincidence rather than intent.
    expect(fuzzyScore('aeo', 'Claude Sonnet 4.6')).toBeNull();
  });

  it('does not match when a letter is absent entirely', () => {
    expect(search('zzz')).toEqual([]);
  });
});

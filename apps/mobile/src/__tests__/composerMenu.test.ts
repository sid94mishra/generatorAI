import { describe, expect, it } from 'vitest';

import {
  applyMenuSelection,
  detectMenu,
  filterCommands,
  filterPaths,
} from '../components/chat/composerMenu';

describe('detectMenu — slash', () => {
  it('opens for a command at the start of the message', () => {
    expect(detectMenu('/term', 5)).toEqual({
      kind: 'slash',
      query: 'term',
      start: 0,
      end: 5,
    });
  });

  it('opens on the bare trigger, so the full command list is offered', () => {
    expect(detectMenu('/', 1)?.kind).toBe('slash');
  });

  it('closes once the caret moves past the command token', () => {
    // "/files src" with the caret in "src" is a message about a path, not a
    // command being typed.
    expect(detectMenu('/files src', 10)?.kind).not.toBe('slash');
  });

  it('ignores a slash that is not the first character', () => {
    expect(detectMenu('see /files', 10)?.kind).not.toBe('slash');
  });
});

describe('detectMenu — mention', () => {
  it('opens after a space', () => {
    expect(detectMenu('look at @But', 12)).toEqual({
      kind: 'mention',
      query: 'But',
      start: 8,
      end: 12,
    });
  });

  it('opens at the very start of the message', () => {
    expect(detectMenu('@src', 4)?.kind).toBe('mention');
  });

  it('does NOT open inside an email address', () => {
    // Otherwise typing "mail me at bob@example.com" pops a file picker.
    expect(detectMenu('bob@example', 11)).toBeNull();
  });

  it('closes once whitespace follows the token', () => {
    expect(detectMenu('@src/a.ts done', 14)).toBeNull();
  });

  it('is null for an empty message', () => {
    expect(detectMenu('', 0)).toBeNull();
  });
});

describe('applyMenuSelection', () => {
  it('replaces only the token and reports the new caret', () => {
    const menu = detectMenu('look at @But', 12)!;
    expect(applyMenuSelection('look at @But', menu, 'src/Button.tsx ')).toEqual({
      text: 'look at src/Button.tsx ',
      caret: 23,
    });
  });

  it('preserves text after the token', () => {
    const menu = detectMenu('@But rest', 4)!;
    expect(applyMenuSelection('@But rest', menu, 'x.ts ').text).toBe('x.ts  rest');
  });
});

describe('filterCommands', () => {
  it('returns everything for an empty query', () => {
    expect(filterCommands('').length).toBeGreaterThan(0);
  });

  it('matches on the id', () => {
    expect(filterCommands('term').map((c) => c.id)).toEqual(['terminal']);
  });

  it('matches on the description', () => {
    expect(filterCommands('diff').map((c) => c.id)).toEqual([]);
    expect(filterCommands('browse').map((c) => c.id)).toContain('files');
  });
});

describe('filterPaths', () => {
  const paths = [
    'docs/button-notes.md',
    'src/components/ui/Button.tsx',
    'src/components/ui/Chip.tsx',
  ];

  it('ranks a basename match above a directory match', () => {
    // Typing "@button" means the component far more often than the note.
    expect(filterPaths(paths, 'button')[0]).toBe('src/components/ui/Button.tsx');
  });

  it('is case-insensitive', () => {
    expect(filterPaths(paths, 'CHIP')).toEqual(['src/components/ui/Chip.tsx']);
  });

  it('respects the limit', () => {
    expect(filterPaths(paths, '', 2)).toHaveLength(2);
  });

  it('returns nothing when there is no match', () => {
    expect(filterPaths(paths, 'zzz')).toEqual([]);
  });
});

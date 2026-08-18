import { describe, it, expect } from 'vitest';
import { Keymap, normalise } from '../Keymap.js';

describe('keymap · sequence chords', () => {
  const keymap = new Keymap({});

  it('registers the leader prefix so the leader context is reachable', () => {
    expect(keymap.lookup(normalise('ctrl+b'), ['global'])).toBe('pane.leader');
  });

  it.each([
    ['g d', 'goto.dashboard'],
    ['g c', 'goto.chats'],
    ['g w', 'goto.workflows'],
    ['g r', 'goto.runs'],
    ['g a', 'goto.automations'],
    ['g p', 'goto.projects'],
    ['g o', 'goto.workspaces'],
    ['g e', 'goto.agents'],
    ['g s', 'goto.scripts'],
    ['g x', 'goto.extensions'],
    ['g ,', 'goto.settings'],
  ])('resolves %s to %s', (chord, id) => {
    expect(keymap.lookup(normalise(chord), ['global'])).toBe(id);
  });

  it('resolves leader chords only inside the leader context', () => {
    expect(keymap.lookup(normalise('%'), ['leader'])).toBe('pane.splitVertical');
    expect(keymap.lookup(normalise('%'), ['global'])).toBeUndefined();
  });
});

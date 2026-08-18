import { describe, it, expect } from 'vitest';
import { Keymap, DEFAULT_KEYMAP, normalise } from '../Keymap.js';
import { CliError } from '../../errors/CliError.js';

describe('normalise', () => {
  it('canonicalises modifier order, separators and casing', () => {
    const want = normalise('ctrl+k');
    for (const variant of ['Ctrl+K', 'CTRL-k', 'ctrl-K']) {
      expect(normalise(variant), variant).toBe(want);
    }
  });

  it('normalises each part of a sequence', () => {
    expect(normalise('g  d')).toBe('g d');
  });

  it('treats a bare capital as the shifted key', () => {
    // `r` resumes a run and `R` retries it; collapsing them loses a binding.
    expect(normalise('R')).toBe('shift+r');
    expect(normalise('R')).not.toBe(normalise('r'));
  });
});

describe('DEFAULT_KEYMAP', () => {
  it('gives every binding an id, chord, description and category', () => {
    for (const b of DEFAULT_KEYMAP) {
      expect(b.id, JSON.stringify(b)).toBeTruthy();
      expect(b.keys, b.id).toBeTruthy();
      expect(b.description, b.id).toBeTruthy();
      expect(b.category, b.id).toBeTruthy();
    }
  });

  it('has unique binding ids', () => {
    const ids = DEFAULT_KEYMAP.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('constructs without conflicts', () => {
    expect(() => new Keymap()).not.toThrow();
  });

  it('reserves the documented global shortcuts', () => {
    const km = new Keymap();
    expect(km.lookup('ctrl+k', ['global'])).toBe('app.palette');
    expect(km.lookup('ctrl+c', ['global'])).toBe('app.quit');
  });

  it('keeps printable chords out of the global context', () => {
    // `?` and `/` must reach the chat composer as text; binding them globally
    // means a question can never be typed.
    const km = new Keymap();
    expect(km.lookup('?', ['global'])).toBeUndefined();
    expect(km.lookup('/', ['global'])).toBeUndefined();
    expect(km.lookup('?', ['list', 'global'])).toBe('app.help');
    expect(km.lookup('/', ['list', 'global'])).toBe('app.search');
  });
});

describe('Keymap', () => {
  it('honours declared alternates', () => {
    const km = new Keymap();
    expect(km.lookup('ctrl+p', ['global'])).toBe('app.palette');
  });

  it('searches contexts innermost-first', () => {
    const km = new Keymap();
    expect(km.lookup('ctrl+k', ['chat', 'global'])).toBe('app.palette');
  });

  it('lets a user remap a binding', () => {
    const km = new Keymap({ 'app.palette': 'ctrl+space' });
    expect(km.lookup('ctrl+space', ['global'])).toBe('app.palette');
    expect(km.binding('app.palette')?.customised).toBe(true);
  });

  it('rejects an override that collides with another binding', () => {
    // Letting one silently win would make a documented shortcut vanish.
    expect(() => new Keymap({ 'app.refresh': 'ctrl+k' })).toThrow(CliError);
  });

  it('rejects an unknown binding id rather than ignoring the typo', () => {
    expect(() => new Keymap({ 'app.nope': 'ctrl+j' })).toThrow(CliError);
  });

  it('exposes a display chord for hints', () => {
    expect(new Keymap().chordFor('app.palette')).toBe('ctrl+k');
  });

  it('groups visible bindings by category for the help overlay', () => {
    const sections = new Keymap().byCategory();
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s) => s.bindings.length > 0)).toBe(true);
    expect(sections.flatMap((s) => s.bindings).some((b) => b.hidden)).toBe(false);
  });

  it('hides kitty-only bindings when the terminal cannot report them', () => {
    const without = new Keymap().byCategory({ kittyKeyboard: false });
    expect(without.flatMap((s) => s.bindings).some((b) => b.requiresKittyKeyboard)).toBe(false);
  });
});

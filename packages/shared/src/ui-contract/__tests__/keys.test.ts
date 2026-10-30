import { describe, expect, it } from 'vitest';
import {
  createSequenceMatcher,
  formatBinding,
  formatBindingText,
  isPlainKeyBinding,
  matchesChord,
  parseChord,
  toElectronAccelerator,
  type KeyLike,
} from '../keys.js';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  code: /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : undefined,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('parseChord / toElectronAccelerator', () => {
  it('parses modifiers and lower-cases the key', () => {
    expect(parseChord('Cmd+Shift+H')).toEqual({ mod: false, cmd: true, ctrl: false, alt: false, shift: true, key: 'h' });
    expect(parseChord('Shift+/')).toMatchObject({ shift: true, key: '/' });
  });

  it('rejects unknown modifiers', () => {
    expect(() => parseChord('Hyper+K')).toThrow();
  });

  it('accelerators must be single chords without Mod', () => {
    expect(toElectronAccelerator('Ctrl+Shift+G')).toBe('Ctrl+Shift+G');
    expect(() => toElectronAccelerator('G H')).toThrow(/sequence/);
    expect(() => toElectronAccelerator('Mod+K')).toThrow(/Mod/);
  });

  it('plain-key bindings are the ones that must not fire while typing', () => {
    expect(isPlainKeyBinding('G C')).toBe(true);
    expect(isPlainKeyBinding('Shift+N')).toBe(true);
    expect(isPlainKeyBinding('Shift+/')).toBe(true);
    expect(isPlainKeyBinding('Mod+K')).toBe(false);
    expect(isPlainKeyBinding('Mod+Alt+B')).toBe(false);
  });
});

describe('formatBinding', () => {
  it('renders per host', () => {
    expect(formatBinding('Cmd+Shift+H', 'desktopMac')).toEqual([['⇧', '⌘', 'H']]);
    expect(formatBinding('Ctrl+1', 'desktopWinLinux')).toEqual([['Ctrl', '1']]);
    expect(formatBinding('G H', 'web')).toEqual([['G'], ['H']]);
    expect(formatBinding('Mod+K', 'web', { mac: true })).toEqual([['⌘', 'K']]);
    expect(formatBinding('Mod+K', 'web', { mac: false })).toEqual([['Ctrl', 'K']]);
    expect(formatBinding('Shift+/', 'web')).toEqual([['?']]);
    expect(formatBinding('Alt+Left', 'desktopWinLinux')).toEqual([['Alt', '←']]);
  });

  it('text form reads "G then H"', () => {
    expect(formatBindingText('G H', 'web')).toBe('G then H');
    expect(formatBindingText('Ctrl+Shift+G', 'desktopWinLinux')).toBe('Ctrl+Shift+G');
    expect(formatBindingText('Cmd+K', 'desktopMac')).toBe('⌘K');
  });
});

describe('matchesChord', () => {
  it('Mod is Cmd on macOS and Ctrl elsewhere', () => {
    expect(matchesChord(key('k', { metaKey: true }), 'Mod+K', true)).toBe(true);
    expect(matchesChord(key('k', { ctrlKey: true }), 'Mod+K', true)).toBe(false);
    expect(matchesChord(key('k', { ctrlKey: true }), 'Mod+K', false)).toBe(true);
    expect(matchesChord(key('k', { metaKey: true }), 'Mod+K', false)).toBe(false);
  });

  it('Shift must agree for letters', () => {
    expect(matchesChord(key('n'), 'N', false)).toBe(true);
    expect(matchesChord(key('N', { shiftKey: true }), 'N', false)).toBe(false);
    expect(matchesChord(key('N', { shiftKey: true }), 'Shift+N', false)).toBe(true);
  });

  it("'Shift+/' matches the '?' keystroke", () => {
    expect(matchesChord({ ...key('?'), code: 'Slash', shiftKey: true }, 'Shift+/', false)).toBe(true);
    expect(matchesChord({ ...key('/'), code: 'Slash' }, 'Shift+/', false)).toBe(false);
  });

  it('Alt on macOS changes event.key, so the physical code is used', () => {
    expect(matchesChord({ ...key('∫'), code: 'KeyB', metaKey: true, altKey: true }, 'Mod+Alt+B', true)).toBe(true);
  });

  it("a shifted symbol chord ('@') matches the shifted keystroke", () => {
    expect(matchesChord({ ...key('@'), code: 'Digit2', shiftKey: true }, '@', false)).toBe(true);
  });
});

describe('createSequenceMatcher', () => {
  const bindings = [
    { id: 'nav.home', binding: 'G H' },
    { id: 'nav.chats', binding: 'G C' },
    { id: 'chat.new', binding: 'N' },
    { id: 'palette.toggle', binding: 'Mod+K' },
  ] as const;

  const setup = () => {
    let t = 0;
    const m = createSequenceMatcher([...bindings], { mac: false, now: () => t, timeoutMs: 1000 });
    return { m, advance: (ms: number) => (t += ms) };
  };

  it('G then C → nav.chats', () => {
    const { m } = setup();
    expect(m.handle(key('g'))).toEqual({ kind: 'pending' });
    expect(m.pending).toBe(true);
    expect(m.handle(key('c'))).toEqual({ kind: 'match', id: 'nav.chats' });
    expect(m.pending).toBe(false);
  });

  it('single chords match immediately', () => {
    const { m } = setup();
    expect(m.handle(key('n'))).toEqual({ kind: 'match', id: 'chat.new' });
    expect(m.handle(key('k', { ctrlKey: true }))).toEqual({ kind: 'match', id: 'palette.toggle' });
  });

  it('a sequence expires after the timeout', () => {
    const { m, advance } = setup();
    m.handle(key('g'));
    advance(1001);
    expect(m.handle(key('c'))).toEqual({ kind: 'none' });
  });

  it('a stray key cancels the sequence; the stray key is matched on its own', () => {
    const { m } = setup();
    m.handle(key('g'));
    expect(m.handle(key('n'))).toEqual({ kind: 'match', id: 'chat.new' });
    expect(m.handle(key('c'))).toEqual({ kind: 'none' });
  });

  it("'G G C' restarts from the second G", () => {
    const { m } = setup();
    m.handle(key('g'));
    expect(m.handle(key('g'))).toEqual({ kind: 'pending' });
    expect(m.handle(key('c'))).toEqual({ kind: 'match', id: 'nav.chats' });
  });

  it('pressing a modifier alone keeps the sequence alive', () => {
    const { m } = setup();
    m.handle(key('g'));
    expect(m.handle(key('Shift', { shiftKey: true }))).toEqual({ kind: 'pending' });
    expect(m.handle(key('h'))).toEqual({ kind: 'match', id: 'nav.home' });
  });

  it('reset() drops a half-typed sequence', () => {
    const { m } = setup();
    m.handle(key('g'));
    m.reset();
    expect(m.handle(key('c'))).toEqual({ kind: 'none' });
  });

  it('G with a modifier does not start a sequence', () => {
    const { m } = setup();
    expect(m.handle(key('g', { ctrlKey: true }))).toEqual({ kind: 'none' });
  });
});

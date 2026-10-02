import { describe, expect, it } from 'vitest';

import { KEY_ROW, controlChord, hostLabel, shortenPath, statusLine, terminalLabel, withModifiers } from './keyRow';

describe('terminal key row (MB-27, MD-38)', () => {
  it('has the MD-38 keys in order', () => {
    expect(KEY_ROW.map((k) => k.label)).toEqual(['esc', 'tab', 'ctrl', 'alt', '^C', '←', '↑', '↓', '→', 'paste', 'find']);
  });

  it('applies latched modifiers', () => {
    expect(controlChord('c')).toBe('\u0003');
    expect(withModifiers('c', { ctrl: true, alt: false })).toBe('\u0003');
    expect(withModifiers('x', { ctrl: false, alt: true })).toBe('\u001bx');
    expect(withModifiers('\u001b[A', { ctrl: true, alt: false }, 'A')).toBe('\u001b[1;5A');
    expect(withModifiers('\u001b[D', { ctrl: true, alt: true }, 'D')).toBe('\u001b[1;7D');
    expect(withModifiers('a', { ctrl: false, alt: false })).toBe('a');
  });

  it('names the host, the path, the status and the instances', () => {
    expect(hostLabel('node-pty')).toBe('pty');
    expect(hostLabel('fallback-child-process')).toBe('fallback');
    expect(shortenPath('/Users/me/src/app/web')).toBe('…/src/app/web');
    expect(statusLine({ shell: '/bin/zsh', pid: 42 }, { cols: 44, rows: 31 })).toBe('zsh · pid 42 · 44×31');
    expect(statusLine(null, { cols: 80, rows: 24 })).toBe('80×24');
    expect([0, 1].map(terminalLabel)).toEqual(['Terminal', 'Terminal 2']);
  });
});

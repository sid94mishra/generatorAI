import { describe, it, expect } from 'vitest';
import { detectTerminal, describeCapabilities } from '../TerminalCapabilities.js';

const tty = { isTTY: true, columns: 120, rows: 40 };

describe('detectTerminal', () => {
  it('treats a piped stdout as non-interactive', () => {
    const caps = detectTerminal({ env: {}, stdout: { isTTY: false } });
    expect(caps.interactive).toBe(false);
    expect(caps.alternateScreen).toBe(false);
  });

  it('treats CI as non-interactive even on a TTY', () => {
    const caps = detectTerminal({ env: { CI: 'true' }, stdout: tty });
    expect(caps.isCI).toBe(true);
    expect(caps.interactive).toBe(false);
  });

  it('honours NO_COLOR over any terminal claim', () => {
    const caps = detectTerminal({
      env: { NO_COLOR: '1', COLORTERM: 'truecolor', TERM_PROGRAM: 'ghostty' },
      stdout: tty,
    });
    expect(caps.colorDepth).toBe('none');
  });

  it('detects truecolor from COLORTERM', () => {
    expect(detectTerminal({ env: { COLORTERM: 'truecolor' }, stdout: tty }).colorDepth).toBe('truecolor');
  });

  it('gives kitty-class terminals the graphics and keyboard protocols', () => {
    const caps = detectTerminal({ env: { TERM_PROGRAM: 'ghostty', COLORTERM: 'truecolor' }, stdout: tty });
    expect(caps.kittyKeyboard).toBe(true);
    expect(caps.graphics).toBe('kitty');
    expect(caps.emulator).toBe('ghostty');
  });

  it('never claims halfblock graphics without at least 256 colours', () => {
    const caps = detectTerminal({ env: { TERM: 'dumb', NO_COLOR: '1' }, stdout: tty });
    expect(caps.graphics).toBe('ascii');
  });

  it('degrades conservatively on legacy Windows conhost', () => {
    const caps = detectTerminal({ env: { TERM: '' }, stdout: tty, platform: 'win32' });
    expect(caps.legacyWindowsConsole).toBe(true);
    expect(caps.kittyKeyboard).toBe(false);
    expect(caps.graphics).toBe('ascii');
  });

  it('does not treat Windows Terminal as conhost', () => {
    const caps = detectTerminal({
      env: { WT_SESSION: 'abc', COLORTERM: 'truecolor' },
      stdout: tty,
      platform: 'win32',
    });
    expect(caps.legacyWindowsConsole).toBe(false);
    expect(caps.colorDepth).toBe('truecolor');
  });

  it('reports a screen reader from INK_SCREEN_READER', () => {
    expect(detectTerminal({ env: { INK_SCREEN_READER: 'true' }, stdout: tty }).screenReader).toBe(true);
  });

  it('honours a reduced-motion request', () => {
    expect(detectTerminal({ env: { GENERATORAI_REDUCED_MOTION: '1' }, stdout: tty }).reducedMotion).toBe(true);
  });

  it('falls back to a sane size when the terminal reports none', () => {
    const caps = detectTerminal({ env: {}, stdout: { isTTY: true } });
    expect(caps.columns).toBeGreaterThanOrEqual(80);
    expect(caps.rows).toBeGreaterThanOrEqual(24);
  });

  it('lets explicit config overrides win over detection', () => {
    const caps = detectTerminal({
      env: { COLORTERM: 'truecolor' },
      stdout: tty,
      overrides: { colorDepth: 'ansi16', mouse: true },
    });
    expect(caps.colorDepth).toBe('ansi16');
    expect(caps.mouse).toBe(true);
  });
});

describe('describeCapabilities', () => {
  it('renders a non-empty single-line summary for diagnostics', () => {
    const text = describeCapabilities(detectTerminal({ env: {}, stdout: tty }));
    expect(text.length).toBeGreaterThan(0);
  });
});

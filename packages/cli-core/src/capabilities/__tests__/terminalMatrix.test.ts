// ────────────────────────────────────────────────────────────────
// Terminal / environment matrix (Phase 9 item 3).
//
// The audit names sixteen environments to test against. Nine of them are
// distinguishable from the environment alone and are pinned here; the rest
// (a real screen reader, SSH latency, actual conhost repaint behaviour) are
// runtime properties only a real-console smoke test can observe.
//
// Every case below is a decision that CORRUPTS the screen when it is wrong:
// an over-claimed capability writes escapes the terminal renders as literal
// text. So each one asserts the conservative side, not merely that some
// value came back.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { detectTerminal } from '../TerminalCapabilities.js';

const tty = { isTTY: true, columns: 120, rows: 40 };
const detect = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform = 'linux') =>
  detectTerminal({ env, stdout: tty, stdin: { isTTY: true }, platform });

describe('colour', () => {
  it('lets NO_COLOR win even when set to the empty string', () => {
    // no-color.org: ANY value, including empty, disables. Testing only
    // `NO_COLOR=1` misses the spelling most scripts actually use.
    expect(detect({ NO_COLOR: '', COLORTERM: 'truecolor' }).colorDepth).toBe('none');
    expect(detect({ NO_COLOR: '', TERM: 'xterm-256color' }).graphics).toBe('ascii');
  });

  it('maps every FORCE_COLOR level, including 0 meaning off', () => {
    expect(detect({ FORCE_COLOR: '0' }).colorDepth).toBe('none');
    expect(detect({ FORCE_COLOR: '1' }).colorDepth).toBe('ansi16');
    expect(detect({ FORCE_COLOR: '2' }).colorDepth).toBe('ansi256');
    expect(detect({ FORCE_COLOR: '3' }).colorDepth).toBe('truecolor');
  });

  it('treats TERM=dumb as no colour and no alternate screen', () => {
    const caps = detect({ TERM: 'dumb' });
    expect(caps.colorDepth).toBe('none');
    expect(caps.alternateScreen).toBe(false);
  });

  it('tells 256-colour and 16-colour TERM strings apart', () => {
    expect(detect({ TERM: 'xterm-256color' }).colorDepth).toBe('ansi256');
    expect(detect({ TERM: 'xterm' }).colorDepth).toBe('ansi16');
  });
});

describe('graphics', () => {
  it('gives tmux and screen no more than their own TERM claims', () => {
    // Inside tmux/screen the OUTER terminal's capabilities are not reachable:
    // TERM is rewritten and passthrough of a kitty graphics APC is off by
    // default. Claiming the outer terminal's protocol dumps escape soup into
    // the multiplexer's scrollback.
    for (const term of ['screen', 'screen-256color', 'tmux-256color']) {
      const caps = detect({ TERM: term });
      expect(caps.graphics).not.toBe('kitty');
      expect(caps.graphics).not.toBe('iterm2');
      expect(caps.kittyKeyboard).toBe(false);
    }
  });

  it('never guesses sixel from the environment', () => {
    // No terminal advertises sixel in env; claiming it wrongly dumps escape
    // soup into the scrollback. Opt-in only.
    expect(detect({ TERM: 'xterm-256color' }).graphics).not.toBe('sixel');
    expect(detect({ TERM: 'mlterm' }).graphics).not.toBe('sixel');
    expect(detect({ TERM: 'xterm-256color', GENERATORAI_TUI_GRAPHICS: 'sixel' }).graphics).toBe('sixel');
  });

  it('ignores an override naming a protocol that does not exist', () => {
    expect(
      detect({ TERM: 'xterm-256color', GENERATORAI_TUI_GRAPHICS: 'nonsense' }).graphics,
    ).not.toBe('nonsense');
  });

  it('gives iTerm2 its own protocol rather than kitty’s', () => {
    expect(detect({ TERM_PROGRAM: 'iTerm.app', COLORTERM: 'truecolor' }).graphics).toBe('iterm2');
  });

  it('gives WezTerm the kitty protocol it actually implements', () => {
    expect(detect({ WEZTERM_PANE: '0', TERM: 'xterm-256color' }).graphics).toBe('kitty');
  });
});

describe('emulator identity', () => {
  it('identifies each modern emulator from its own marker variable', () => {
    // TERM_PROGRAM is not set by all of them, which is why each has a
    // fallback marker.
    expect(detect({ GHOSTTY_RESOURCES_DIR: '/x' }).emulator).toBe('ghostty');
    expect(detect({ KITTY_WINDOW_ID: '1' }).emulator).toBe('kitty');
    expect(detect({ WEZTERM_PANE: '0' }).emulator).toBe('wezterm');
    expect(detect({ ALACRITTY_SOCKET: '/x' }).emulator).toBe('alacritty');
    expect(detect({ WT_SESSION: 'abc' }).emulator).toBe('windows-terminal');
  });
});

describe('platform degradation', () => {
  it('treats WSL as an ordinary Linux terminal, not as Windows', () => {
    // WSL runs on `platform: 'linux'` with a real TERM; the conhost
    // degradation must not apply to it.
    const caps = detect(
      { TERM: 'xterm-256color', WSL_DISTRO_NAME: 'Ubuntu', LANG: 'C.UTF-8' },
      'linux',
    );
    expect(caps.legacyWindowsConsole).toBe(false);
    expect(caps.unicode).toBe(true);
  });

  it('keeps a modern emulator modern when it runs on Windows', () => {
    // Keying "conhost" on `platform === 'win32'` alone would demote
    // Ghostty / WezTerm / kitty running there.
    expect(detect({ TERM_PROGRAM: 'ghostty' }, 'win32').legacyWindowsConsole).toBe(false);
    expect(detect({ ConEmuANSI: 'ON' }, 'win32').legacyWindowsConsole).toBe(false);
    expect(detect({}, 'win32').legacyWindowsConsole).toBe(true);
  });

  it('withholds mouse and bracketed paste from a terminal that cannot do them', () => {
    // Enabling mouse reporting takes text selection away from the terminal,
    // which users experience as the app being broken.
    expect(detect({ NO_COLOR: '' }).mouse).toBe(false);
    expect(detect({}, 'win32').mouse).toBe(false);
    expect(detect({}, 'win32').bracketedPaste).toBe(false);
    expect(detect({ TERM: 'xterm-256color' }).bracketedPaste).toBe(true);
  });

  it('claims OSC 8 hyperlinks only for terminals known to render them', () => {
    expect(detect({ TERM_PROGRAM: 'ghostty' }).hyperlinks).toBe(true);
    expect(detect({ WT_SESSION: 'abc' }).hyperlinks).toBe(true);
    // A plain xterm renders an unsupported OSC 8 as visible junk.
    expect(detect({ TERM: 'xterm-256color' }).hyperlinks).toBe(false);
  });
});

describe('unicode and accessibility', () => {
  it('assumes UTF-8 only where it is actually safe to', () => {
    expect(detect({ LANG: 'en_US.UTF-8' }, 'linux').unicode).toBe(true);
    expect(detect({ LC_ALL: 'C.utf8' }, 'linux').unicode).toBe(true);
    expect(detect({ LANG: 'en_US.ISO-8859-1' }, 'linux').unicode).toBe(false);
    // No locale on Windows: the console code page is not UTF-8 by default.
    expect(detect({}, 'win32').unicode).toBe(false);
    // …but Windows Terminal and VS Code are, and they rarely set LANG.
    expect(detect({ WT_SESSION: 'abc' }, 'win32').unicode).toBe(true);
    expect(detect({ TERM_PROGRAM: 'vscode' }, 'win32').unicode).toBe(true);
  });

  it('lets an explicit request disable unicode, and a falsy one not disable it', () => {
    expect(detect({ LANG: 'en_US.UTF-8', GENERATORAI_NO_UNICODE: '1' }).unicode).toBe(false);
    expect(detect({ LANG: 'en_US.UTF-8', GENERATORAI_NO_UNICODE: '0' }).unicode).toBe(true);
  });

  it('reports a screen reader from either supported variable', () => {
    expect(detect({ GENERATORAI_SCREEN_READER: 'true' }).screenReader).toBe(true);
    expect(detect({ INK_SCREEN_READER: '1' }).screenReader).toBe(true);
    expect(detect({}).screenReader).toBe(false);
  });

  it('suppresses animation wherever nobody can see it', () => {
    expect(detectTerminal({ env: {}, stdout: { isTTY: false } }).reducedMotion).toBe(true);
    expect(detect({ CI: 'true' }).reducedMotion).toBe(true);
    expect(detect({ GENERATORAI_REDUCED_MOTION: '1' }).reducedMotion).toBe(true);
    expect(detect({ TERM: 'xterm-256color' }).reducedMotion).toBe(false);
  });

  it('recognises the CI variables each provider actually sets', () => {
    expect(detect({ GITHUB_ACTIONS: 'true' }).isCI).toBe(true);
    expect(detect({ CONTINUOUS_INTEGRATION: '1' }).isCI).toBe(true);
    expect(detect({ BUILD_NUMBER: '42' }).isCI).toBe(true);
    // `CI=false` is a real spelling and means not-CI.
    expect(detect({ CI: 'false' }).isCI).toBe(false);
  });
});

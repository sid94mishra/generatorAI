// ────────────────────────────────────────────────────────────────
// What this terminal can actually do.
//
// Codex ships an entire crate for this and it earns its place: every
// rendering decision downstream (colour depth, whether an image can be drawn,
// whether Ctrl+I is distinguishable from Tab, whether mouse reporting will
// break text selection) depends on the answer, and getting it wrong is
// invisible in development and obvious to the user.
//
// Detection is deliberately conservative: when a signal is ambiguous we
// report the lesser capability. A missing feature degrades; a wrongly claimed
// feature corrupts the screen.
// ────────────────────────────────────────────────────────────────

export type ColorDepth =
  /** No colour at all — NO_COLOR, a pipe, or a dumb terminal. */
  | 'none'
  /** The original 8/16 ANSI colours. */
  | 'ansi16'
  /** xterm-256. */
  | 'ansi256'
  /** 24-bit RGB. */
  | 'truecolor';

export type GraphicsProtocol = 'kitty' | 'iterm2' | 'sixel' | 'halfblock' | 'ascii';

export interface TerminalCapabilities {
  /** stdout is a TTY and we are not in CI. */
  interactive: boolean;
  isTTY: boolean;
  isCI: boolean;
  columns: number;
  rows: number;
  colorDepth: ColorDepth;
  /** Best available image transport. `halfblock` needs at least ansi256. */
  graphics: GraphicsProtocol;
  /** CSI ? u — lets us tell Ctrl+I from Tab and see key releases. */
  kittyKeyboard: boolean;
  /** SGR mouse reporting (1006). */
  mouse: boolean;
  /** Bracketed paste (2004) — multi-line paste arrives as one string. */
  bracketedPaste: boolean;
  /** OSC 8 clickable hyperlinks. */
  hyperlinks: boolean;
  /** Mode 2027 — grapheme clusters measured correctly. */
  unicodeWidth: boolean;
  /** Safe to draw box-drawing characters and emoji. */
  unicode: boolean;
  /** Alternate screen buffer is usable. */
  alternateScreen: boolean;
  /** A screen reader is active; prefer linear output. */
  screenReader: boolean;
  /** Animation should be suppressed. */
  reducedMotion: boolean;
  /** Program name, best effort — 'ghostty', 'kitty', 'wezterm', 'vscode', … */
  emulator: string;
  /** Windows conhost, which lacks most of the above. */
  legacyWindowsConsole: boolean;
}

export interface DetectOptions {
  env?: NodeJS.ProcessEnv;
  stdout?: { isTTY?: boolean; columns?: number; rows?: number };
  stdin?: { isTTY?: boolean };
  platform?: NodeJS.Platform;
  /** Explicit user overrides from config; win over detection. */
  overrides?: Partial<TerminalCapabilities>;
}

const TRUECOLOR_TERMS = ['ghostty', 'kitty', 'wezterm', 'alacritty', 'iterm', 'vscode', 'contour', 'rio'];
const KITTY_KEYBOARD_TERMS = ['ghostty', 'kitty', 'wezterm', 'rio', 'contour'];
/** Emulators that are strictly more capable than conhost, on any platform. */
const MODERN_TERMS = [...TRUECOLOR_TERMS, 'mintty', 'hyper', 'tabby'];

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

function detectEmulator(env: NodeJS.ProcessEnv): string {
  if (env['TERM_PROGRAM']) return env['TERM_PROGRAM'].toLowerCase();
  if (env['GHOSTTY_RESOURCES_DIR']) return 'ghostty';
  if (env['KITTY_WINDOW_ID']) return 'kitty';
  if (env['WEZTERM_PANE'] !== undefined) return 'wezterm';
  if (env['ALACRITTY_SOCKET'] || env['ALACRITTY_LOG']) return 'alacritty';
  if (env['WT_SESSION']) return 'windows-terminal';
  if (env['KONSOLE_VERSION']) return 'konsole';
  if (env['VTE_VERSION']) return 'vte';
  return (env['TERM'] ?? 'unknown').toLowerCase();
}

function detectCI(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env['CI'] && env['CI'].toLowerCase() !== 'false',
  ) || Boolean(env['CONTINUOUS_INTEGRATION'] || env['BUILD_NUMBER'] || env['GITHUB_ACTIONS']);
}

function detectColorDepth(env: NodeJS.ProcessEnv, isTTY: boolean, emulator: string): ColorDepth {
  // NO_COLOR is a hard contract (no-color.org): any value, even empty, disables.
  if (env['NO_COLOR'] !== undefined) return 'none';
  if (env['FORCE_COLOR'] !== undefined) {
    const level = env['FORCE_COLOR'];
    if (level === '0') return 'none';
    if (level === '1') return 'ansi16';
    if (level === '2') return 'ansi256';
    return 'truecolor';
  }
  if (!isTTY) return 'none';

  const colorterm = (env['COLORTERM'] ?? '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor';
  if (TRUECOLOR_TERMS.some((t) => emulator.includes(t))) return 'truecolor';

  const term = (env['TERM'] ?? '').toLowerCase();
  if (term === 'dumb') return 'none';
  if (term.includes('256')) return 'ansi256';
  if (env['WT_SESSION']) return 'truecolor';
  if (term.includes('color') || term.startsWith('xterm') || term.startsWith('screen')) {
    return 'ansi16';
  }
  return 'ansi16';
}

function detectGraphics(
  env: NodeJS.ProcessEnv,
  emulator: string,
  depth: ColorDepth,
): GraphicsProtocol {
  if (env['GENERATORAI_TUI_GRAPHICS']) {
    const forced = env['GENERATORAI_TUI_GRAPHICS'].toLowerCase();
    if (['kitty', 'iterm2', 'sixel', 'halfblock', 'ascii'].includes(forced)) {
      return forced as GraphicsProtocol;
    }
  }
  if (depth === 'none') return 'ascii';
  if (emulator.includes('ghostty') || emulator.includes('kitty') || env['KITTY_WINDOW_ID']) {
    return 'kitty';
  }
  if (emulator.includes('wezterm')) return 'kitty';
  if (emulator.includes('iterm')) return 'iterm2';
  // Sixel is common on xterm builds and mlterm but is not advertised in env;
  // claiming it wrongly dumps escape soup into the scrollback, so we do not
  // guess. Users on a sixel terminal set GENERATORAI_TUI_GRAPHICS=sixel.
  return depth === 'ansi16' ? 'ascii' : 'halfblock';
}

function detectUnicode(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (truthy(env['GENERATORAI_NO_UNICODE'])) return false;
  const locale = env['LC_ALL'] ?? env['LC_CTYPE'] ?? env['LANG'] ?? '';
  if (/utf-?8/i.test(locale)) return true;
  // Windows Terminal and VS Code's terminal are UTF-8 regardless of LANG,
  // which is usually unset there.
  if (env['WT_SESSION'] || env['TERM_PROGRAM'] === 'vscode') return true;
  if (platform === 'win32') return false;

  // A locale that NAMES a charset and does not name UTF-8 is positive
  // evidence against unicode, not the absence of evidence — `LANG=C`,
  // `POSIX`, and `en_US.ISO-8859-1` all render box-drawing characters and
  // emoji as mojibake. This used to fall through to the "any non-empty
  // locale means modern" default below and claim unicode for all three.
  const normalised = locale.toLowerCase();
  if (normalised === 'c' || normalised === 'posix') return false;
  if (normalised.includes('.')) return false;

  // A locale with no charset suffix at all (`LANG=en_US`) on a unix-like
  // system: no evidence either way, and modern terminals there are
  // overwhelmingly UTF-8. Unchanged behaviour.
  return locale !== '';
}

export function detectTerminal(options: DetectOptions = {}): TerminalCapabilities {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const stdout = options.stdout ?? (typeof process !== 'undefined' ? process.stdout : undefined);
  const stdin = options.stdin ?? (typeof process !== 'undefined' ? process.stdin : undefined);

  const isTTY = Boolean(stdout?.isTTY);
  const isCI = detectCI(env);
  const emulator = detectEmulator(env);
  const colorDepth = detectColorDepth(env, isTTY, emulator);
  // conhost is the *unknown* Windows terminal. Keying on "not Windows
  // Terminal" would demote Ghostty/WezTerm/kitty running on Windows, which
  // support strictly more than conhost does.
  const legacyWindowsConsole =
    platform === 'win32' &&
    !env['WT_SESSION'] &&
    !env['ConEmuANSI'] &&
    emulator !== 'vscode' &&
    !MODERN_TERMS.some((t) => emulator.includes(t));

  const base: TerminalCapabilities = {
    interactive: isTTY && !isCI && Boolean(stdin?.isTTY),
    isTTY,
    isCI,
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
    colorDepth,
    graphics: detectGraphics(env, emulator, colorDepth),
    kittyKeyboard:
      isTTY && !legacyWindowsConsole && KITTY_KEYBOARD_TERMS.some((t) => emulator.includes(t)),
    mouse: isTTY && !legacyWindowsConsole && colorDepth !== 'none',
    bracketedPaste: isTTY && !legacyWindowsConsole,
    hyperlinks:
      isTTY &&
      (emulator.includes('ghostty') ||
        emulator.includes('kitty') ||
        emulator.includes('wezterm') ||
        emulator.includes('iterm') ||
        emulator === 'vscode' ||
        Boolean(env['WT_SESSION'])),
    unicodeWidth: emulator.includes('ghostty') || emulator.includes('kitty'),
    unicode: detectUnicode(env, platform),
    alternateScreen: isTTY && !isCI && (env['TERM'] ?? '') !== 'dumb',
    screenReader:
      truthy(env['INK_SCREEN_READER']) || truthy(env['GENERATORAI_SCREEN_READER']),
    reducedMotion: truthy(env['GENERATORAI_REDUCED_MOTION']) || isCI || !isTTY,
    emulator,
    legacyWindowsConsole,
  };

  return { ...base, ...(options.overrides ?? {}) };
}

/** One-line summary for `system doctor` and the TUI status bar tooltip. */
export function describeCapabilities(caps: TerminalCapabilities): string {
  const bits = [
    caps.emulator,
    `${caps.columns}x${caps.rows}`,
    caps.colorDepth,
    `graphics:${caps.graphics}`,
  ];
  if (caps.kittyKeyboard) bits.push('kitty-kbd');
  if (caps.mouse) bits.push('mouse');
  if (!caps.unicode) bits.push('ascii-only');
  if (caps.isCI) bits.push('ci');
  return bits.join(' · ');
}

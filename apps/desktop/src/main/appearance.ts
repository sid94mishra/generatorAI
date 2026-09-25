// ────────────────────────────────────────────────────────────────
// Appearance mirror (D-25; 06-desktop-and-shell.md §6.1–§6.4).
//
// The renderer's ThemeProvider is the ONLY writer of appearance. Main mirrors
// what it pushes:
//
//   renderer ── IPC.setAppearance({ mode, themeId, ground*, fg* }) ──► commitAppearance()
//     validate → persist → nativeTheme.themeSource = mode → repaint window
//     background + caption glyphs → View ▸ Appearance radio
//
//   View ▸ Appearance click ── IPC_EVENT.appearanceRequest({ mode }) ──► renderer
//     (the renderer applies it and pushes back through the loop above)
//
// `appearanceMirror()` answers "what colour is the window right now" for the
// splash, the main window, the bare error window, the prompt window and the
// Windows/Linux caption glyphs. Before the first push it is the Instrument
// default (DEFAULT_APPEARANCE).
// ────────────────────────────────────────────────────────────────

import { nativeTheme } from 'electron';
import type { AppearancePush, ThemePreference } from '../shared/ipc';
import { loadSettings, type AppearanceSettings } from './config';
import { validateSettingValue } from './settings-schema';

export interface MirroredAppearance {
  dark: boolean;
  /** Window background (`--gai-ground`), `#rrggbb`. */
  ground: string;
  /** Caption glyph colour (`--gai-fg`), `#rrggbb`. */
  fg: string;
}

/** Whether `mode` resolves to dark, given what the OS prefers. */
export function isDarkMode(mode: ThemePreference, systemDark: boolean): boolean {
  return mode === 'system' ? systemDark : mode === 'dark';
}

/**
 * The colours to paint now. `systemDark` defaults to the OS, which for a
 * `system` user is what Chromium will resolve `prefers-color-scheme` to.
 */
export function appearanceMirror(
  appearance: AppearanceSettings = loadSettings().appearance,
  systemDark: boolean = nativeTheme.shouldUseDarkColors,
): MirroredAppearance {
  const dark = isDarkMode(appearance.mode, systemDark);
  return dark
    ? { dark, ground: appearance.groundDark, fg: appearance.fgDark }
    : { dark, ground: appearance.groundLight, fg: appearance.fgLight };
}

export interface CommitAppearanceDeps {
  save: (appearance: AppearanceSettings) => void;
  setThemeSource: (mode: ThemePreference) => void;
  /** setBackgroundColor on open windows + repaint the WCO caption glyphs. */
  repaint: () => void;
  updateMenu: (mode: ThemePreference) => void;
}

export type CommitResult = { ok: true; appearance: AppearanceSettings } | { ok: false; error: string };

/**
 * Handles one `IPC.setAppearance` push. A malformed payload is refused before
 * anything is written: a colour string that `setBackgroundColor` rejects, or a
 * mode Electron does not know, must not reach disk and poison the next launch.
 */
export function commitAppearance(payload: unknown, deps: CommitAppearanceDeps): CommitResult {
  const checked = validateSettingValue('appearance', payload);
  if (!checked.ok) return { ok: false, error: checked.error };
  const appearance: AppearancePush = checked.value;
  deps.save(appearance);
  // themeSource drives prefers-color-scheme in the renderer and the native
  // chrome (menus, dialogs, WCO), so it must equal the app's own mode or
  // "System" lies and Windows caption glyphs go dark-on-dark.
  deps.setThemeSource(appearance.mode);
  deps.repaint();
  deps.updateMenu(appearance.mode);
  return { ok: true, appearance };
}

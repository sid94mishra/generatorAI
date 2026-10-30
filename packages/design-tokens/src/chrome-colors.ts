// ────────────────────────────────────────────────────────────────
// Window chrome colours per theme (06-desktop-and-shell.md §3.1, §6.4).
//
// The desktop window paints `ground` before the renderer exists and tints the
// Windows caption glyphs with `fg`, so both must be plain `#rrggbb` literals
// that `BrowserWindow.setBackgroundColor` accepts — never a CSS expression.
// Root export only: this file reads the theme tables, which the lean
// `./chrome` subpath must not pull into the Electron main bundle.
// ────────────────────────────────────────────────────────────────

import { parseHex, relativeLuminance, toHex } from './color.js';
import { getThemeDef } from './themes/index.js';
import type { Appearance } from './themes/types.js';

export interface ChromeColors {
  /** Window background: the darker of the theme's background/card (`--gai-ground`). */
  ground: string;
  /** Primary text colour (`--gai-fg`); caption button symbols. */
  fg: string;
}

const hex6 = (colour: string): string => toHex({ ...parseHex(colour), a: 1 });

/**
 * `ground` follows the design-token rule (02 §2.2 step 1): the lower-luminance
 * of `background`/`card`, ties → `background`. Unknown theme ids fall back to
 * the default theme, like every other theme lookup.
 */
export function chromeColors(themeId: string, appearance: Appearance): ChromeColors {
  const spec = getThemeDef(themeId)[appearance];
  const background = parseHex(spec.background);
  const card = parseHex(spec.card);
  const ground = relativeLuminance(card) < relativeLuminance(background) ? spec.card : spec.background;
  return { ground: hex6(ground), fg: hex6(spec.foreground) };
}

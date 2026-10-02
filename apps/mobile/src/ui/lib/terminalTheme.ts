// The xterm palette for terminal renderers (MB-27, MD-38; 02 §2.6): blocks hosting xterm read the active theme's
// terminal palette here — only `ui/` reads theme colours (lint `themeColorsInFeature`). A plain record, the shape
// `terminalHtml` sanitises; `background` also paints the WebView so no white frame shows while it loads.
import { useMemo } from 'react';

import { useThemeColors } from './themeColors';

export function useTerminalTheme(): Record<string, string> {
  const colors = useThemeColors();
  return useMemo(() => Object.fromEntries(Object.entries(colors.terminal).filter((e): e is [string, string] => typeof e[1] === 'string')), [colors.terminal]);
}

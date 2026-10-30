// The navigator's own theme (06 §1.2 #5): react-navigation paints scene backgrounds, the default header, cards and
// sheets from it, and defaults to its LIGHT theme — which drew a white native header over dark app themes. It
// follows the active app theme and appearance, so the native chrome changes with every theme switch.
import React, { useMemo } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';

import { useTheme } from './ThemeProvider';

export function NavigationTheme({ children }: { children: React.ReactNode }): React.ReactElement {
  const { appearance, colors } = useTheme();
  const value = useMemo(() => {
    const base = appearance === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: appearance === 'dark',
      colors: { ...base.colors, primary: colors.accent, background: colors.surface, card: colors.surface, text: colors.fg, border: colors.lineSoft, notification: colors.warn },
    };
  }, [appearance, colors.accent, colors.surface, colors.fg, colors.lineSoft, colors.warn]);
  return <NavigationThemeProvider value={value}>{children}</NavigationThemeProvider>;
}

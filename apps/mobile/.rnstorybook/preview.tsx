import React from 'react';
import { View } from 'react-native';
import type { Preview } from '@storybook/react-native';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { isKnownMode, isKnownTheme } from '@generatorai/design-tokens';

function ThemeCanvas({ children }: { children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  return <View style={[theme.style, { flex: 1, backgroundColor: theme.colors.background }]}>{children}</View>;
}
const preview: Preview = {
  initialGlobals: { theme: 'instrument', mode: 'dark', accent: 'ink' },
  decorators: [(Story, context) => {
    const theme = isKnownTheme(context.globals.theme) ? String(context.globals.theme) : 'instrument';
    const mode = isKnownMode(context.globals.mode) ? context.globals.mode : 'dark';
    const accent = typeof context.globals.accent === 'string' ? context.globals.accent : 'ink';
    return (
      <ThemeProvider key={`${theme}:${mode}:${accent}`} initialTheme={theme} initialMode={mode} initialAccent={accent} persist={false}>
        <ThemeCanvas><Story /></ThemeCanvas>
      </ThemeProvider>
    );
  }],
};
export default preview;

// Jest helper: render inside a scoped preview ThemeProvider, so kit components can read useThemeColors().
import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeProvider';

export function themed(node: React.ReactElement): React.ReactElement {
  return (
    <ThemeProvider initialTheme="instrument" initialMode="dark" initialAccent="ink" persist={false}>
      {node}
    </ThemeProvider>
  );
}

export function renderThemed(node: React.ReactElement): ReturnType<typeof render> {
  return render(themed(node));
}

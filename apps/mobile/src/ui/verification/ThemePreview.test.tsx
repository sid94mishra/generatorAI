import React from 'react';
import { Button } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../../theme/ThemeProvider';
import { prefs } from '../../services/storage/prefs';

jest.mock('../../services/storage/prefs', () => ({ prefs: { getString: jest.fn(), setString: jest.fn() } }));
function PreviewControl(): React.ReactElement {
  const theme = useTheme();
  return <Button accessibilityLabel={`${theme.themeId}/${theme.mode}/${theme.accent}`} title="Change preview" onPress={() => theme.setMode('light')} />;
}
it('changes a preview without overwriting the saved app appearance', async () => {
  const user = userEvent.setup();
  await render(<ThemeProvider initialTheme="instrument" initialMode="dark" initialAccent="ink" persist={false}><PreviewControl /></ThemeProvider>);
  await user.press(screen.getByRole('button', { name: 'instrument/dark/ink' }));
  expect(screen.getByRole('button', { name: 'instrument/light/ink' })).toBeEnabled();
  expect(prefs.setString).not.toHaveBeenCalled();
});

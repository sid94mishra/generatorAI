import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { Link } from './Link';
import { renderThemed } from '../../__tests__/themed';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve()) }));

describe('Link (MP-44)', () => {
  it('is a link that calls onPress', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Link label="See all" standalone onPress={onPress} />);
    await user.press(screen.getByRole('link', { name: 'See all' }));
    expect(onPress).toHaveBeenCalled();
  });
  it('opens an external url in the browser', async () => {
    const user = userEvent.setup();
    await renderThemed(<Link label="Docs" url="https://example.com" standalone />);
    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link.props.accessibilityHint).toBe('Opens in the browser');
    await user.press(link);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://example.com');
  });
});

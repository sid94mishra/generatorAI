import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Icon } from './Icon';
import { ThemeProvider } from '../../../theme/ThemeProvider';

jest.mock('../../../services/storage/prefs', () => ({ prefs: { getString: jest.fn(), setString: jest.fn() } }));

const themed = (node: React.ReactElement): React.ReactElement => (
  <ThemeProvider initialTheme="instrument" initialMode="dark" initialAccent="ink" persist={false}>
    {node}
  </ThemeProvider>
);

describe('Icon', () => {
  it('is an image with its label when labelled', async () => {
    await render(themed(<Icon concept="status-running" spinning accessibilityLabel="Running" testID="icon" />));
    expect(screen.getByRole('image', { name: 'Running' })).toBeTruthy();
  });

  it('is hidden from assistive tech when decorative', async () => {
    await render(themed(<Icon concept="changes" testID="icon" />));
    expect(screen.queryByRole('image')).toBeNull();
    const node = screen.getByTestId('icon', { includeHiddenElements: true });
    expect(node.props.accessible).toBe(false);
    expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('draws filled and lucide-only concepts without throwing', async () => {
    await render(themed(<><Icon concept="pin" filled /><Icon concept="webhook" tone="accent" /></>));
    expect(screen.toJSON()).toBeTruthy();
  });
});

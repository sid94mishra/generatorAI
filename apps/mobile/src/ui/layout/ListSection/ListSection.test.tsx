import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { Text } from '../../primitives/Text';
import { ListSection } from './ListSection';
import { rowPosition } from './listSectionModel';
import { renderThemed } from '../../__tests__/themed';

describe('ListSection (ML-12)', () => {
  it('positions rows for group corners', () => {
    expect([0, 1, 2].map((i) => rowPosition(i, 3))).toEqual(['first', 'middle', 'last']);
    expect(rowPosition(0, 1)).toBe('only');
  });

  it('renders a header, its action, the rows and the footer', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <ListSection title="App" count={2} action={{ label: 'See all', onPress }} footer="Per device.">
        <Text>Row one</Text>
        <Text>Row two</Text>
      </ListSection>,
    );
    expect(screen.getByRole('header', { name: 'App' })).toBeTruthy();
    expect(screen.getByText('Row two')).toBeTruthy();
    expect(screen.getByText('Per device.')).toBeTruthy();
    await user.press(screen.getByRole('link', { name: 'See all' }));
    expect(onPress).toHaveBeenCalled();
  });
});

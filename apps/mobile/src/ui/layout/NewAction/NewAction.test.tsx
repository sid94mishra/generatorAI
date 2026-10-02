import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { NewAction } from './NewAction';
import { renderThemed } from '../../__tests__/themed';

describe('NewAction (ML-09)', () => {
  it('keeps its label as the accessible name, also when collapsed', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<NewAction label="New chat" icon="plus" onPress={onPress} collapsed testID="home-new-chat" />);
    const button = screen.getByRole('button', { name: 'New chat' });
    expect(screen.queryByText('New chat')).toBeNull();
    await user.press(button);
    expect(onPress).toHaveBeenCalled();
  });

  it('ellipsizes a long label on one line', async () => {
    await renderThemed(<NewAction label="A deliberately long label that keeps going well past the capsule" icon="plus" onPress={jest.fn()} />);
    const text = screen.getByText('A deliberately long label that keeps going well past the capsule');
    expect(text.props.numberOfLines).toBe(1);
    expect(text.props.ellipsizeMode).toBe('tail');
  });
});

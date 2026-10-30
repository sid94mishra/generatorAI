import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { ChoiceCard, choiceCardSurface } from './ChoiceCard';
import { renderThemed } from '../../__tests__/themed';

describe('ChoiceCard (MP-48)', () => {
  it('is a radio with its state, title and description in the name', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<ChoiceCard value="s" title="Schedule" description="Runs at set times" selected onPress={onPress} />);
    const card = screen.getByRole('radio', { name: 'Schedule, Runs at set times' });
    expect(card.props.accessibilityState).toMatchObject({ checked: true });
    await user.press(card);
    expect(onPress).toHaveBeenCalled();
    expect(choiceCardSurface(true)).toContain('bg-selected');
    expect(choiceCardSurface(false)).toContain('bg-raised');
  });

  it('blocks a locked card and reads the reason', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<ChoiceCard value="e" title="Repository event" selected={false} locked="Requires admin access" onPress={onPress} />);
    const card = screen.getByRole('radio', { name: 'Repository event, Requires admin access' });
    await user.press(card);
    expect(onPress).not.toHaveBeenCalled();
    expect(card.props.accessibilityHint).toBe('Requires admin access');
  });
});

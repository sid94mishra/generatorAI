import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { ActionRow } from './ActionRow';
import { actionLayout, buttonVariant, stackedOrder } from './actionRowModel';
import { renderThemed } from '../../__tests__/themed';

const deny = { id: 'deny', label: 'Deny', role: 'secondary' as const, onPress: jest.fn() };
const allow = { id: 'allow_once', label: 'Allow once', role: 'primary' as const, onPress: jest.fn(), accessibilityLabel: 'Allow git push' };

describe('ActionRow (MB-15 action row)', () => {
  it('lays out per platform and stacks narrow or large-text rows, primary first (MD-50)', () => {
    expect(actionLayout('ios', 380, 1)).toBe('equal');
    expect(actionLayout('android', 380, 1)).toBe('end');
    expect(actionLayout('ios', 340, 1)).toBe('stacked');
    expect(actionLayout('android', 400, 1.4)).toBe('stacked');
    expect(stackedOrder([deny, allow]).map((a) => a.id)).toEqual(['allow_once', 'deny']);
    expect(buttonVariant('danger')).toBe('destructive');
    expect(buttonVariant('quiet')).toBe('ghost');
  });

  it('names actions by their accessible label and runs them; shows the note', async () => {
    const user = userEvent.setup();
    await renderThemed(<ActionRow actions={[deny, allow]} note="Face ID required" />);
    await user.press(screen.getByRole('button', { name: 'Allow git push' }));
    expect(allow.onPress).toHaveBeenCalled();
    expect(screen.getByText('Face ID required')).toBeTruthy();
  });
});

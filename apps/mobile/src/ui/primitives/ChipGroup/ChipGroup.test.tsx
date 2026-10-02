import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { ChipGroup, nextSelection } from './ChipGroup';
import { renderThemed } from '../../__tests__/themed';

const items = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }];

describe('ChipGroup (MP-11)', () => {
  it('computes single and multi selection', () => {
    expect(nextSelection('single', 'a', 'b')).toBe('b');
    expect(nextSelection('multi', ['a'], 'b')).toEqual(['a', 'b']);
    expect(nextSelection('multi', ['a', 'b'], 'a')).toEqual(['b']);
  });

  it('is a labelled radiogroup for single selection and reports the change', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<ChipGroup items={items} selection="single" value="a" onValueChange={onValueChange} accessibilityLabel="Filter" testID="g" />);
    // A container role, not a focusable element: the chips inside stay individually focusable.
    expect(screen.getByTestId('g').props).toMatchObject({ accessibilityRole: 'radiogroup', accessibilityLabel: 'Filter' });
    await user.press(screen.getByRole('button', { name: 'Beta' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('shows +N in wrap mode and expands', async () => {
    const user = userEvent.setup();
    await renderThemed(<ChipGroup items={items} layout="wrap" max={1} accessibilityLabel="Tags" />);
    await user.press(screen.getByRole('button', { name: '+2' }));
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeTruthy();
  });
});

import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { Chip, chipSurface } from './Chip';
import { renderThemed } from '../../__tests__/themed';

describe('Chip (MP-10)', () => {
  it('toggles as a selected button inside a hit frame', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Chip label="Active" count={12} selected onPress={onPress} testID="c" />);
    const chip = screen.getByRole('button', { name: 'Active, 12' });
    expect(chip.props.accessibilityState).toMatchObject({ selected: true });
    await user.press(chip);
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByTestId('c').props.className).toContain('min-h-hit');
  });

  it('gives the remove control its own name, and names a locked composer chip', async () => {
    const onRemove = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <>
        <Chip label="frontend" variant="input" onRemove={onRemove} />
        <Chip label="Bug Fixer" variant="composer" locked onPress={jest.fn()} />
      </>,
    );
    await user.press(screen.getByRole('button', { name: 'Remove frontend' }));
    expect(onRemove).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Bug Fixer, locked' })).toBeTruthy();
  });

  it('selects with a fill and never by colour alone (MD-49)', () => {
    expect(chipSurface('filter', true, false)).toContain('bg-selected');
    expect(chipSurface('filter', false, false)).toContain('ios:border-line');
    expect(chipSurface('attachment', false, true)).toContain('border-err');
  });
});

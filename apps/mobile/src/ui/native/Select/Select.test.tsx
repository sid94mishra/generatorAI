import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { Select } from './Select';
import { filterSelectOptions, selectAccessibilityLabel, selectMenuItems, selectValueText } from './selectModel';
import { renderThemed } from '../../__tests__/themed';

const OPTIONS = [
  { value: 'main', label: 'main' },
  { value: 'dev', label: 'develop' },
];

describe('Select (MP-24)', () => {
  it('names itself "<label>, <value>" and checks the current option', () => {
    expect(selectAccessibilityLabel({ label: 'Base branch', options: OPTIONS, value: 'dev' })).toBe('Base branch, develop');
    expect(selectValueText({ options: OPTIONS, value: null, placeholder: 'Choose' })).toBe('Choose');
    expect(selectMenuItems(OPTIONS, 'main').map((i) => ('checked' in i ? i.checked : undefined))).toEqual([true, false]);
  });

  it('opens a menu and reports a new value', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Select label="Base branch" options={OPTIONS} value="main" onValueChange={onValueChange} />);
    const trigger = screen.getByRole('button', { name: 'Base branch, main' });
    expect(trigger.props.accessibilityHint).toBe('Opens a menu');
    await user.press(trigger);
    await user.press(screen.getByRole('menuitem', { name: 'develop' }));
    expect(onValueChange).toHaveBeenCalledWith('dev');
  });

  it('searches a long list in a sheet and applies the pick', async () => {
    expect(filterSelectOptions(OPTIONS, 'DEV').map((o) => o.value)).toEqual(['dev']);
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Select label="Branch" options={OPTIONS} value="main" onValueChange={onValueChange} searchable />);
    await user.press(screen.getByRole('button', { name: 'Branch, main' }));
    await user.type(screen.getByLabelText('Search branch'), 'dev');
    expect(screen.queryByRole('radio', { name: 'main' })).toBeNull();
    await user.press(screen.getByRole('radio', { name: 'develop' }));
    expect(onValueChange).toHaveBeenCalledWith('dev');
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    await renderThemed(<Select label="Base branch" options={OPTIONS} value="main" onValueChange={jest.fn()} disabled />);
    await user.press(screen.getByRole('button', { name: 'Base branch, main' }));
    expect(screen.queryByRole('menuitem', { name: 'develop' })).toBeNull();
  });
});

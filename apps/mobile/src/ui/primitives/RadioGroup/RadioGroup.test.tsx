import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { RADIO_SIDE, RadioGroup, RadioOption } from './RadioGroup';
import { renderThemed } from '../../__tests__/themed';
import { nativePlatform } from '../../platform/geometry';

describe('RadioGroup (MP-21)', () => {
  it('exposes a radiogroup of checked radios and selects on press', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <RadioGroup value="a" onValueChange={onValueChange} accessibilityLabel="Fixture location">
        <RadioOption value="a" label="Alpha" />
        <RadioOption value="b" label="Beta" description="second" />
        <RadioOption value="c" label="Gamma" disabled />
      </RadioGroup>,
    );
    expect(screen.getByLabelText('Fixture location').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: 'Alpha' }).props.accessibilityState).toMatchObject({ checked: true });
    await user.press(screen.getByRole('radio', { name: 'Beta, second' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
    await user.press(screen.getByRole('radio', { name: 'Gamma' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it('places the indicator per platform (MD-49)', () => {
    expect(RADIO_SIDE).toBe(nativePlatform === 'android' ? 'leading' : 'trailing');
  });
});

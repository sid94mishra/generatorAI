import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { CALLOUT_TONES, Callout } from './Callout';
import { renderThemed } from '../../__tests__/themed';

describe('Callout (MP-45)', () => {
  it('maps tones to state surfaces and glyphs (MD-25)', () => {
    expect(CALLOUT_TONES.err).toMatchObject({ surface: 'bg-err-bg', tone: 'err' });
    expect(CALLOUT_TONES.info.surface).toBe('bg-selected');
  });

  it('is an alert for warn / err and runs its action', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Callout tone="err" title="Process exited with code 1" action={{ label: 'Retry', onPress }} testID="c" />);
    expect(screen.getByTestId('c').props.accessibilityRole).toBe('alert');
    await user.press(screen.getByRole('link', { name: 'Retry' }));
    expect(onPress).toHaveBeenCalled();
  });
});

import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { Button } from './Button';
import { buttonSurface } from './buttonStyles';
import { renderThemed } from '../../__tests__/themed';

describe('Button (MP-04)', () => {
  it('is a named button that fires onPress inside a hit-target frame', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<Button label="Allow once" variant="primary" onPress={onPress} testID="b" />);
    await user.press(screen.getByRole('button', { name: 'Allow once' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('b').props.className).toContain('min-h-hit');
  });

  it('uses the ambiguity label, blocks presses while disabled or loading, and reports busy', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <>
        <Button label="Deny" accessibilityLabel="Deny git push" disabled onPress={onPress} />
        <Button label="Commit" loading onPress={onPress} />
      </>,
    );
    const deny = screen.getByRole('button', { name: 'Deny git push' });
    expect(deny).toBeDisabled();
    await user.press(deny);
    const commit = screen.getByRole('button', { name: 'Commit' });
    expect(commit.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await user.press(commit);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('draws the MD-51 sizes as capsules and only primary fills with the accent (MD-22)', () => {
    expect(buttonSurface({ variant: 'primary', size: 'lg' })).toContain('bg-accent');
    expect(buttonSurface({ variant: 'primary', size: 'lg' })).toContain('min-h-control-lg');
    expect(buttonSurface({ variant: 'destructive' })).not.toContain('bg-err');
    expect(buttonSurface({ variant: 'tonal' })).toContain('android:bg-selected');
    for (const v of ['primary', 'secondary', 'ghost', 'destructive', 'tonal'] as const) expect(buttonSurface({ variant: v })).toContain('rounded-full');
  });
});

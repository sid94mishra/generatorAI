import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, screen, userEvent } from '@testing-library/react-native';
import { Text } from '../../primitives/Text';
import { FullScreenEditor, changeCountText } from './FullScreenEditor';
import { renderThemed } from '../../__tests__/themed';

describe('FullScreenEditor (ML-11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('counts changes only while dirty', () => {
    expect(changeCountText(true, 3)).toBe('3 changes');
    expect(changeCountText(true, 1)).toBe('1 change');
    expect(changeCountText(false, 3)).toBeUndefined();
  });

  it('confirms with the header text action and cancels directly when clean', async () => {
    const save = jest.fn();
    const onCancel = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <FullScreenEditor title="Edit agent" primary={{ label: 'Save', onPress: save }} onCancel={onCancel} dirty={false}>
        <Text>Form</Text>
      </FullScreenEditor>,
    );
    expect(screen.getByRole('header', { name: 'Edit agent' })).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalled();
    await user.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('asks before cancelling a dirty editor and shows the count', async () => {
    const onCancel = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <FullScreenEditor title="Edit agent" primary={{ label: 'Save', onPress: jest.fn(), loading: true }} onCancel={onCancel} dirty dirtyCount={2}>
        <Text>Form</Text>
      </FullScreenEditor>,
    );
    expect(screen.getByText('2 changes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState).toMatchObject({ busy: true });
    await user.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => ((Alert.alert as jest.Mock).mock.calls.at(-1)![2] as AlertButton[])[1]!.onPress?.());
    expect(onCancel).toHaveBeenCalled();
  });
});

import React from 'react';
import { Alert, Platform, type AlertButton } from 'react-native';
import { act, screen, userEvent } from '@testing-library/react-native';
import { Text } from '../../primitives/Text';
import { FullScreenEditor, changeCountText } from './FullScreenEditor';
import { renderThemed } from '../../__tests__/themed';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';
import { WindowInsetsProvider, useModalInsets } from '../../platform/insets';

const WINDOW: EdgeInsets = { top: 59, right: 0, bottom: 34, left: 0 };
const CONSUMED: EdgeInsets = { top: 0, right: 0, bottom: 34, left: 0 };

/** The shell's providers: the window's insets, and the column's consumed ones (top paid by the column). */
function Shell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <WindowInsetsProvider insets={WINDOW}>
      <SafeAreaInsetsContext.Provider value={CONSUMED}>{children}</SafeAreaInsetsContext.Provider>
    </WindowInsetsProvider>
  );
}

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

  it('clears the status bar: iOS pays the window inset (not the column-consumed 0); Android sits in the column', async () => {
    await renderThemed(
      <Shell>
        <FullScreenEditor title="Edit workflow" onCancel={jest.fn()} dirty={false} testID="fse">
          <Text>Form</Text>
        </FullScreenEditor>
      </Shell>,
    );
    const root = screen.getByTestId('fse');
    const flat = Object.assign({}, ...[root.props.style].flat(Infinity).filter(Boolean)) as { paddingTop?: number };
    expect(flat.paddingTop).toBe(Platform.OS === 'ios' ? 59 : 0);
    // The bar itself is inside that padding.
    expect(screen.getByTestId('fse-bar')).toBeTruthy();
  });

  it('takes the window insets on iOS and the local ones on Android (the modal stays in the column)', async () => {
    const seen: Record<string, EdgeInsets> = {};
    function Probe(): null {
      seen.ios = useModalInsets('ios');
      seen.android = useModalInsets('android');
      return null;
    }
    await renderThemed(
      <Shell>
        <Probe />
      </Shell>,
    );
    expect(seen.ios!.top).toBe(59);
    expect(seen.android!.top).toBe(0);
  });
});


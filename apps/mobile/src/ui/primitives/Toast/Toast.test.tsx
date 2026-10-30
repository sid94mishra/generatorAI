import React from 'react';
import { act, fireEvent, screen, userEvent } from '@testing-library/react-native';
import { ToastHost } from './Toast';
import { closeToast, resetToasts, toast, toastDuration } from './toastModel';
import { renderThemed } from '../../__tests__/themed';

describe('Toast (MP-30)', () => {
  afterEach(async () => act(async () => resetToasts()));

  it('uses the MD-58 durations and requires undo handlers', () => {
    expect(toastDuration({ kind: 'error', message: 'x' })).toBe(6000);
    expect(toastDuration({ kind: 'undo', message: 'x', undo: { onUndo: jest.fn() } })).toBe(5000);
    expect(toastDuration({ kind: 'background', message: 'x', durationMs: 1000 })).toBe(1000);
    expect(() => toast({ kind: 'undo', message: 'x' })).toThrow(/undo/);
  });

  it('shows one toast; undo restores instead of committing', async () => {
    const onUndo = jest.fn();
    const commit = jest.fn(async () => undefined);
    const user = userEvent.setup();
    await renderThemed(<ToastHost />);
    await act(async () => {
      toast({ kind: 'undo', message: 'Chat archived', undo: { onUndo, commit } });
    });
    expect(screen.getByText('Chat archived')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(screen.queryByText('Chat archived')).toBeNull();
  });

  it('commits a replaced undo toast and expires after its duration', async () => {
    jest.useFakeTimers();
    const commit = jest.fn(async () => undefined);
    await renderThemed(<ToastHost />);
    await act(async () => {
      toast({ kind: 'undo', message: 'Chat archived', undo: { onUndo: jest.fn(), commit } });
    });
    await act(async () => {
      toast({ kind: 'error', message: "Couldn't load chats" });
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Chat archived')).toBeNull();
    await act(async () => jest.advanceTimersByTime(6000));
    expect(screen.queryByText("Couldn't load chats")).toBeNull();
    jest.useRealTimers();
  });

  it('runs the action and offers a Dismiss accessibility action', async () => {
    const open = jest.fn();
    await renderThemed(<ToastHost />);
    let handle!: ReturnType<typeof toast>;
    await act(async () => {
      handle = toast({ kind: 'background', message: 'Run #248 succeeded', action: { label: 'Open', onPress: open }, testID: 't' });
    });
    const node = screen.getByTestId('t');
    expect(node.props.accessibilityActions.map((a: { label: string }) => a.label)).toEqual(['Dismiss', 'Open']);
    fireEvent(node, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(open).toHaveBeenCalled();
    await act(async () => handle.dismiss());
    act(() => closeToast(999));
  });
});

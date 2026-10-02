import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, screen, userEvent } from '@testing-library/react-native';
import { Button } from '../../primitives/Button';
import { Text } from '../../primitives/Text';
import { Sheet } from './Sheet';
import { SheetModal, SheetProvider, useSheet } from './SheetJs';
import { actionPlacementProblem, detentHeight, dragOutcome, routeSheetOptions } from './sheetModel';
import { renderThemed } from '../../__tests__/themed';

describe('Sheet (ML-10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('sizes detents, resolves drags and builds route options', () => {
    expect(detentHeight('medium', 800, 0)).toBe(400);
    expect(detentHeight('large', 800, 0)).toBe(736);
    expect(detentHeight('content', 800, 900)).toBe(736);
    expect(dragOutcome({ translation: 300, velocity: 0, height: 400, index: 0, count: 2 })).toEqual({ kind: 'dismiss' });
    expect(dragOutcome({ translation: 300, velocity: 0, height: 700, index: 1, count: 2 })).toEqual({ kind: 'snap', index: 0 });
    expect(dragOutcome({ translation: -100, velocity: 0, height: 400, index: 0, count: 2 })).toEqual({ kind: 'snap', index: 1 });
    expect(dragOutcome({ translation: 10, velocity: 0, height: 400, index: 0, count: 2 })).toEqual({ kind: 'snap', index: 0 });
    expect(routeSheetOptions('picker', true)).toMatchObject({ presentation: 'formSheet', gestureEnabled: false });
    expect(actionPlacementProblem({ headerAction: { label: 'Done', onPress: jest.fn() }, footer: 'x' })).toMatch(/MD-85/);
  });

  it('closes with its header control and runs the selection text action', async () => {
    const onDismiss = jest.fn();
    const done = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <Sheet title="Model" onDismiss={onDismiss} headerAction={{ label: 'Done', onPress: done }}>
        <Text>Body</Text>
      </Sheet>,
    );
    await user.press(screen.getByRole('button', { name: 'Done' }));
    expect(done).toHaveBeenCalled();
    const close = screen.queryByRole('button', { name: 'Close' });
    if (close) {
      await user.press(close);
      expect(onDismiss).toHaveBeenCalled();
    }
  });

  it('asks before dismissing a dirty modal sheet', async () => {
    const onDismiss = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <SheetModal open title="Rename chat" dirty onDismiss={onDismiss} footer={<Button label="Save" onPress={jest.fn()} />}>
        <Text>Body</Text>
      </SheetModal>,
    );
    await user.press(screen.getByRole('button', { name: 'Close sheet' }));
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)![0]).toBe('Discard changes?');
    await act(async () => ((Alert.alert as jest.Mock).mock.calls.at(-1)![2] as AlertButton[])[1]!.onPress?.());
    expect(onDismiss).toHaveBeenCalled();
  });

  it('presents one imperative sheet at a time', async () => {
    function Opener(): React.ReactElement {
      const sheet = useSheet();
      return (
        <>
          <Button label="A" onPress={() => sheet.present(<Text>First</Text>, { title: 'One' })} />
          <Button label="B" onPress={() => sheet.present(<Text>Second</Text>, { title: 'Two' })} />
        </>
      );
    }
    const user = userEvent.setup();
    await renderThemed(
      <SheetProvider>
        <Opener />
      </SheetProvider>,
    );
    await user.press(screen.getByRole('button', { name: 'A' }));
    expect(screen.getByText('First')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'B' }));
    expect(screen.queryByText('First')).toBeNull();
    expect(screen.getByText('Second')).toBeTruthy();
  });
});

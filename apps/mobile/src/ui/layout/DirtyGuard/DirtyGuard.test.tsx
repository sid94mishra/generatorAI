import React, { useEffect } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act } from '@testing-library/react-native';
import { REMOVAL_SETTLE_MS, useDirtyGuard } from './useDirtyGuard';
import type { DirtyGuard, RemovalSource } from './DirtyGuard.types';
import { renderThemed } from '../../__tests__/themed';
import { useBackHandler } from '../../platform/back';

jest.mock('../../platform/back', () => ({ useBackHandler: jest.fn() }));

function pressAlert(index: number): void {
  const call = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  (call[2] as AlertButton[])[index]!.onPress?.();
}

function Probe({ dirty, onReady, ...options }: { dirty: boolean; onReady: (g: DirtyGuard) => void; onDiscard?: () => void; navigation?: RemovalSource }): null {
  const guard = useDirtyGuard(dirty, options);
  useEffect(() => {
    onReady(guard);
  });
  return null;
}

describe('DirtyGuard (ML-30)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('intercepts Android Back while dirty when it can discard', async () => {
    const onDiscard = jest.fn();
    await renderThemed(<Probe dirty onDiscard={onDiscard} onReady={() => undefined} />);
    const [active, handler] = (useBackHandler as jest.Mock).mock.calls.at(-1)! as [boolean, () => boolean];
    expect(active).toBe(true);
    expect(handler()).toBe(true);
    await act(async () => pressAlert(1));
    expect(onDiscard).toHaveBeenCalled();
  });

  it('runs guarded actions immediately when clean and only after Discard when dirty', async () => {
    let g!: DirtyGuard;
    const fn = jest.fn(() => 'done');
    const { rerender } = await renderThemed(<Probe dirty={false} onReady={(x) => (g = x)} />);
    await expect(g.guard(fn)).resolves.toBe('done');
    expect(Alert.alert).not.toHaveBeenCalled();
    await rerender(<Probe dirty onReady={(x) => (g = x)} />);
    const kept = g.guard(fn);
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)![0]).toBe('Discard changes?');
    pressAlert(0);
    await expect(kept).resolves.toBeUndefined();
    const discarded = g.guard(fn);
    pressAlert(1);
    await expect(discarded).resolves.toBe('done');
  });

  it('blocks router removal while dirty and replays it after Discard', async () => {
    let listener: ((e: { preventDefault: () => void; data: { action: unknown } }) => void) | undefined;
    const navigation: RemovalSource = { addListener: (_e, cb) => ((listener = cb), () => undefined), dispatch: jest.fn() };
    await renderThemed(<Probe dirty navigation={navigation} onReady={() => undefined} />);
    const preventDefault = jest.fn();
    act(() => listener!({ preventDefault, data: { action: { type: 'GO_BACK' } } }));
    expect(preventDefault).toHaveBeenCalled();
    await act(async () => new Promise((r) => setTimeout(r, REMOVAL_SETTLE_MS + 10)));
    await act(async () => pressAlert(1));
    expect(navigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  });


});

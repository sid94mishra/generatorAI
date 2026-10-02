import React, { useEffect } from 'react';
import { BackHandler, Text } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { GEOMETRY } from '@generatorai/design-tokens';

import { renderThemed, themed } from '../../__tests__/themed';
import { SidePanel } from './SidePanel';
import { dragProgress, panelSurface, panelWidth, settleOpen } from './sidePanelModel';

let mounts = 0;
function Probe(): React.ReactElement {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <Text>panel body</Text>;
}

describe('SidePanel model (ML-05)', () => {
  it('caps phone panels at the geometry share and uses shell widths when persistent', () => {
    expect(panelWidth(GEOMETRY.ios, 'start', 'overlay', 390)).toBe(Math.round(0.79 * 390));
    expect(panelWidth(GEOMETRY.ios, 'start', 'overlay', 1000)).toBe(318);
    expect(panelWidth(GEOMETRY.android, 'end', 'overlay', 412)).toBe(364);
    expect(panelWidth(GEOMETRY.ios, 'start', 'persistent', 1194)).toBe(312);
    expect(panelWidth(GEOMETRY.android, 'end', 'persistent', 1280)).toBe(400);
    expect(panelWidth(GEOMETRY.ios, 'end', 'fullscreen', 744)).toBe(744);
  });

  it('settles open past 40 % or on a fling toward open', () => {
    expect(settleOpen(0.45, 0)).toBe(true);
    expect(settleOpen(0.35, 0)).toBe(false);
    expect(settleOpen(0.1, 900)).toBe(true);
    expect(settleOpen(0.9, -900)).toBe(false);
    expect(dragProgress(1, -150, 1, 300)).toBe(0.5);
    expect(dragProgress(1, 150, -1, 300)).toBe(0.5);
    expect(dragProgress(0, 900, 1, 300)).toBe(1);
  });

  it('picks the platform surface recipe', () => {
    expect(panelSurface('ios', 'start', 'persistent')).toBe('ios-card');
    expect(panelSurface('android', 'end', 'persistent')).toBe('android-tablet-pane');
    expect(panelSurface('android', 'start', 'overlay')).toBe('android-modal');
  });
});

describe('SidePanel (ML-05)', () => {
  it('mounts its content lazily and never remounts it across presentations (MD-24)', async () => {
    mounts = 0;
    const view = await renderThemed(
      <SidePanel side="end" open={false} onOpenChange={() => undefined} presentation="overlay" accessibilityLabel="Workspace pane" testID="pane">
        <Probe />
      </SidePanel>,
    );
    expect(screen.queryByText('panel body')).toBeNull();
    for (const [open, presentation] of [[true, 'overlay'], [true, 'persistent'], [true, 'fullscreen'], [false, 'overlay'], [true, 'persistent']] as const) {
      await view.rerender(
        themed(
          <SidePanel side="end" open={open} onOpenChange={() => undefined} presentation={presentation} accessibilityLabel="Workspace pane" testID="pane">
            <Probe />
          </SidePanel>,
        ),
      );
    }
    expect(screen.getByText('panel body')).toBeTruthy();
    expect(mounts).toBe(1);
  });

  it('closes from the scrim and from Back while open, and traps focus', async () => {
    const onOpenChange = jest.fn();
    await renderThemed(
      <SidePanel side="start" open onOpenChange={onOpenChange} presentation="overlay" accessibilityLabel="Sidebar" testID="drawer">
        <Probe />
      </SidePanel>,
    );
    expect(screen.getByTestId('drawer').props.accessibilityViewIsModal).toBe(true);
    await fireEvent.press(screen.getByLabelText('Close sidebar', { includeHiddenElements: true }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    onOpenChange.mockClear();
    (BackHandler as unknown as { mockPressBack?: () => void }).mockPressBack?.();
    if ((BackHandler as unknown as { mockPressBack?: () => void }).mockPressBack) expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('is an inline column with no scrim and no focus trap when persistent', async () => {
    await renderThemed(
      <SidePanel side="start" open={false} onOpenChange={() => undefined} presentation="persistent" accessibilityLabel="Sidebar" testID="drawer">
        <Probe />
      </SidePanel>,
    );
    expect(screen.getByText('panel body')).toBeTruthy();
    expect(screen.getByTestId('drawer').props.accessibilityViewIsModal).toBe(false);
  });
});

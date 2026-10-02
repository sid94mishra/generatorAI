import React, { useEffect } from 'react';
import { Text } from 'react-native';
import * as RN from 'react-native';
import { screen } from '@testing-library/react-native';

import { renderThemed, themed } from '../../__tests__/themed';
import { SidePanel } from '../SidePanel';
import { AdaptiveLayout } from './AdaptiveLayout';
import { adaptivePresentations, fullscreenWidth } from './adaptiveModel';

const mounts: Record<string, number> = {};
function Probe({ name }: { name: string }): React.ReactElement {
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
  }, [name]);
  return <Text>{name}</Text>;
}

let width = 599;
const dims = (): RN.ScaledSize => ({ width, height: 900, scale: 2, fontScale: 1 });

function Shell(): React.ReactElement {
  return (
    <AdaptiveLayout
      testID="shell"
      endOpen
      start={({ presentation }) => (
        <SidePanel side="start" open={false} onOpenChange={() => undefined} presentation={presentation} accessibilityLabel="Sidebar" testID="drawer">
          <Probe name="sidebar" />
        </SidePanel>
      )}
      end={(slot) => (
        <SidePanel side="end" open onOpenChange={() => undefined} presentation={slot.presentation} accessibilityLabel="Workspace pane" testID="pane">
          <Probe name="pane" />
        </SidePanel>
      )}
    >
      <Probe name="main" />
    </AdaptiveLayout>
  );
}

describe('AdaptiveLayout (ML-17, MD-24)', () => {
  it('maps size classes to panel presentations', () => {
    expect(adaptivePresentations('compact', { endOpen: true })).toEqual({ start: 'overlay', end: 'overlay' });
    expect(adaptivePresentations('medium', { endOpen: true })).toEqual({ start: 'persistent', end: 'overlay' });
    expect(adaptivePresentations('expanded', { endOpen: true })).toEqual({ start: 'persistent', end: 'persistent' });
    expect(adaptivePresentations('expanded', { endOpen: false })).toEqual({ start: 'persistent', end: 'overlay' });
    expect(adaptivePresentations('expanded', { startHidden: true, endOpen: true, endFullscreen: true })).toEqual({ start: 'overlay', end: 'fullscreen' });
    expect(fullscreenWidth(1194, 'persistent', 312)).toBe(882);
    expect(fullscreenWidth(744, 'overlay', 312)).toBe(744);
  });

  it('never remounts the main column or the panels while the window crosses 600 and 840', async () => {
    const spy = jest.spyOn(RN, 'useWindowDimensions').mockImplementation(dims);
    for (const k of Object.keys(mounts)) delete mounts[k];
    width = 599;
    const view = await renderThemed(<Shell />);
    for (const w of [600, 840, 1194, 599, 840]) {
      width = w;
      await view.rerender(themed(<Shell />));
    }
    expect(screen.getByText('main')).toBeTruthy();
    expect(mounts).toEqual({ main: 1, sidebar: 1, pane: 1 });
    spy.mockRestore();
  });
});

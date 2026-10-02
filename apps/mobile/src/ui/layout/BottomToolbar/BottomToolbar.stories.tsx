import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { BottomToolbar } from './BottomToolbar';

const noop = (): void => undefined;
const NAV = [
  { icon: 'chevron-up' as const, label: 'Previous step', onPress: noop },
  { icon: 'chevron-down' as const, label: 'Next step', onPress: noop },
];

function BottomToolbarGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Step detail (nav + Copy + primary), file preview (actions only), nav only">
        <BottomToolbar nav={NAV} actions={[{ label: 'Copy', icon: 'copy', onPress: noop }]} primary={{ label: 'Retry step', icon: 'retry', onPress: noop }} />
        <BottomToolbar actions={[{ label: 'Open in pane', onPress: noop }, { label: 'Share', onPress: noop }]} />
        <BottomToolbar nav={NAV} />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <BottomToolbar nav={NAV} primary={{ label: 'Retry step', icon: 'retry', onPress: noop }} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/BottomToolbar', component: BottomToolbarGallery } satisfies Meta<typeof BottomToolbarGallery>;
export default meta;
export const Toolbars: StoryObj<typeof meta> = {};

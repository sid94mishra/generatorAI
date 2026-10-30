import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { StickyActionBar } from './StickyActionBar';

const noop = (): void => undefined;

function StickyActionBarGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="New chat (summary + primary), wizard (Back · Continue), primary only, loading">
        <StickyActionBar summary={{ title: 'Bug Fixer · Claude Sonnet 5', subtitle: 'payments-service · Auto' }} primary={{ label: 'Create chat', onPress: noop }} />
        <StickyActionBar secondary={{ label: 'Back', onPress: noop }} primary={{ label: 'Continue', onPress: noop }} />
        <StickyActionBar primary={{ label: 'Run', icon: 'play', onPress: noop }} />
        <StickyActionBar summary={{ title: LONG_TEXT }} primary={{ label: 'Commit', onPress: noop, loading: true }} />
      </StorySection>
      <StorySection title="Font scale 2.0">
        <WithFontScale scale={2}>
          <StickyActionBar summary={{ title: 'Bug Fixer', subtitle: 'Auto' }} primary={{ label: 'Create chat', onPress: noop }} />
        </WithFontScale>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StickyActionBar summary={{ title: 'Bug Fixer', subtitle: 'Auto' }} primary={{ label: 'Create chat', onPress: noop }} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/StickyActionBar', component: StickyActionBarGallery } satisfies Meta<typeof StickyActionBarGallery>;
export default meta;
export const Bars: StoryObj<typeof meta> = {};

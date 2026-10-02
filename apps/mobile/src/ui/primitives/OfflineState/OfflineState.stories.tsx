import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { OfflineState } from './OfflineState';

const noop = (): void => undefined;

function OfflineStateGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Banner: offline (saved data), reconnecting, unreachable">
        <OfflineState form="banner" state="offline" onRetry={noop} />
        <OfflineState form="banner" state="reconnecting" />
        <OfflineState form="banner" state="unreachable" serverName="This computer" onRetry={noop} />
      </StorySection>
      <StorySection title="Screen: Retry + Switch server">
        <OfflineState form="screen" state="unreachable" serverName="This computer" address="http://192.168.1.24:3100" onRetry={noop} onSwitchServer={noop} />
      </StorySection>
      <StorySection title="Long server name, font scale 2.0, right to left">
        <OfflineState form="banner" state="unreachable" serverName={LONG_TEXT} onRetry={noop} />
        <WithFontScale scale={2}>
          <OfflineState form="banner" state="offline" onRetry={noop} />
        </WithFontScale>
        <RightToLeft>
          <OfflineState form="banner" state="offline" onRetry={noop} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <OfflineState form="banner" state="offline" onRetry={noop} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/OfflineState', component: OfflineStateGallery } satisfies Meta<typeof OfflineStateGallery>;
export default meta;
export const Forms: StoryObj<typeof meta> = {};

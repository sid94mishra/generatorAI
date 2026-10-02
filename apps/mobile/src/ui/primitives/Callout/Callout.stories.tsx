import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Callout } from './Callout';

const noop = (): void => undefined;

function CalloutGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Card: info (stale data + Retry), warn, err (step failure), ok">
        <Callout tone="info" title="Showing saved data" body="Couldn't refresh." action={{ label: 'Retry', onPress: noop }} />
        <Callout tone="warn" title="Notifications are off" body="You won't hear when an agent needs you." action={{ label: 'Open Settings', onPress: noop }} />
        <Callout tone="err" title="Process exited with code 1" body="3 of 20 tests failed." />
        <Callout tone="ok" title="Access approved" body="You can edit the network settings now." />
      </StorySection>
      <StorySection title="Banner">
        <Callout form="banner" tone="warn" title="Notifications are off" action={{ label: 'Turn on', onPress: noop }} />
        <Callout form="banner" tone="info" title="Showing saved data" action={{ label: 'Retry', onPress: noop }} />
      </StorySection>
      <StorySection title="Long body, font scale 2.0, right to left">
        <Callout tone="err" title="Process exited with code 1" body={LONG_TEXT} />
        <WithFontScale scale={2}>
          <Callout tone="warn" title="Sensitive scope" body="Admins see this request." />
        </WithFontScale>
        <RightToLeft>
          <Callout tone="info" title="Showing saved data" action={{ label: 'Retry', onPress: noop }} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Callout tone="err" title="Process exited with code 1" body="3 of 20 tests failed." />
          <Callout tone="warn" title="Notifications are off" form="banner" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Callout', component: CalloutGallery } satisfies Meta<typeof CalloutGallery>;
export default meta;
export const Tones: StoryObj<typeof meta> = {};

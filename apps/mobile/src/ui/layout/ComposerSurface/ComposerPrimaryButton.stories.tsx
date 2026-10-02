import React from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { ComposerPrimaryButton } from './ComposerPrimaryButton';

const noop = (): void => undefined;

function PrimaryGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Send · Send disabled · Stop · Stopping (inert) · Force reset">
        <View className="flex-row flex-wrap items-center gap-3">
          <ComposerPrimaryButton kind="send" onPress={noop} />
          <ComposerPrimaryButton kind="send" disabled disabledReason="Answer the permission above to send" onPress={noop} />
          <ComposerPrimaryButton kind="stop" stopLabel="Stop Bug Fixer" onPress={noop} />
          <ComposerPrimaryButton kind="stopping" onPress={noop} />
          <ComposerPrimaryButton kind="force" onPress={noop} />
        </View>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <ComposerPrimaryButton kind="send" onPress={noop} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/ComposerPrimaryButton', component: PrimaryGallery } satisfies Meta<typeof PrimaryGallery>;
export default meta;
export const States: StoryObj<typeof meta> = {};

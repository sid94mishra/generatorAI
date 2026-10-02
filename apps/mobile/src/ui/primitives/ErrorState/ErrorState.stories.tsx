import React from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { ErrorState } from './ErrorState';

const noop = (): void => undefined;

function ErrorStateGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Screen: network error with Retry, server error with a code, no retry">
        <ErrorState title="Couldn't load chats" error={new Error('Network request failed')} onRetry={noop} />
        <ErrorState title="Couldn't load runs" error={{ message: 'Forbidden', status: 403 }} onRetry={noop} />
        <ErrorState title="Couldn't load the plan" error="The plan was deleted." />
      </StorySection>
      <StorySection title="Inline row inside a list">
        <View className="rounded-group bg-raised">
          <ErrorState inline title="Couldn't load worktrees" error={new Error('git: not a repository')} onRetry={noop} />
        </View>
      </StorySection>
      <StorySection title="Long message, font scale 2.0, right to left">
        <ErrorState title="Couldn't load chats" error={new Error(LONG_TEXT)} onRetry={noop} />
        <WithFontScale scale={2}>
          <ErrorState inline title="Couldn't load worktrees" error="Timeout" onRetry={noop} />
        </WithFontScale>
        <RightToLeft>
          <ErrorState inline title="Couldn't load worktrees" error="Timeout" onRetry={noop} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <ErrorState title="Couldn't load chats" error="Network request failed" onRetry={noop} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/ErrorState', component: ErrorStateGallery } satisfies Meta<typeof ErrorStateGallery>;
export default meta;
export const Forms: StoryObj<typeof meta> = {};

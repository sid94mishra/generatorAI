import React from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';
import { EMPTY_STATE_COPY, type EmptyStateKey } from '@generatorai/shared/ui-contract';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { EmptyState } from './EmptyState';

const noop = (): void => undefined;
const KEYS = Object.keys(EMPTY_STATE_COPY) as EmptyStateKey[];

function EmptyStateGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="With the module's New (secondary), no results + Clear search, compact (in a card)">
        <EmptyState copyKey="runs" action={{ label: 'Run workflow', icon: 'play', onPress: noop }} />
        <EmptyState copyKey="searchResults" action={{ label: 'Clear search', onPress: noop }} />
        <View className="rounded-card bg-raised">
          <EmptyState copyKey="needsYou" compact />
        </View>
      </StorySection>
      <StorySection title="Every EMPTY_STATE_COPY key">
        {KEYS.map((key) => (
          <EmptyState key={key} copyKey={key} compact />
        ))}
      </StorySection>
      <StorySection title="Custom copy, long text, font scale 2.0, right to left">
        <EmptyState icon="computer" title="Computer use is off" description={LONG_TEXT} />
        <WithFontScale scale={2}>
          <EmptyState copyKey="chats" action={{ label: 'New chat', icon: 'plus', onPress: noop }} />
        </WithFontScale>
        <RightToLeft>
          <EmptyState copyKey="chats" />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <EmptyState copyKey="runs" action={{ label: 'Run workflow', icon: 'play', onPress: noop }} compact />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/EmptyState', component: EmptyStateGallery } satisfies Meta<typeof EmptyStateGallery>;
export default meta;
export const AllKeys: StoryObj<typeof meta> = {};

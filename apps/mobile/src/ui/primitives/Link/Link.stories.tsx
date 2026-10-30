import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Text } from '../Text';
import { Link } from './Link';

function LinkGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Inline (in prose) and external">
        <Text role="transcript">
          Read the <Link label="runbook" onPress={() => undefined} /> or the <Link label="docs" url="https://example.com" />.
        </Text>
      </StorySection>
      <StorySection title="Standalone">
        <StoryRow>
          <Link label="See all" standalone onPress={() => undefined} />
          <Link label="View in run" standalone onPress={() => undefined} />
          <Link label="Open on GitHub" standalone url="https://github.com" />
        </StoryRow>
      </StorySection>
      <StorySection title="Right to left (chevron mirrors)">
        <RightToLeft>
          <Link label="See all" standalone onPress={() => undefined} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Link label="Breakdown" standalone onPress={() => undefined} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Link', component: LinkGallery } satisfies Meta<typeof LinkGallery>;
export default meta;
export const Forms: StoryObj<typeof meta> = {};

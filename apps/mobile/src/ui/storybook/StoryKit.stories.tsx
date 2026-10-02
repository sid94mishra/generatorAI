import React from 'react';
import { Text } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix } from './StoryKit';

function StoryKitDemo(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Text className="text-body text-fg">Body on surface</Text>
        </ThemeMatrix>
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <StoryRow>
            <Text className="text-ui text-fg">First</Text>
            <Text className="text-ui text-fg-2">Second</Text>
          </StoryRow>
        </RightToLeft>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Storybook/StoryKit', component: StoryKitDemo } satisfies Meta<typeof StoryKitDemo>;
export default meta;
export const Default: StoryObj<typeof meta> = {};

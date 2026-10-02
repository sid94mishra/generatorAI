import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Text } from '../Text';
import { Pressable } from './Pressable';

function Counter({ feedback, disabled = false }: { feedback: 'scale' | 'highlight' | 'none'; disabled?: boolean }): React.ReactElement {
  const [count, setCount] = useState(0);
  return (
    <Pressable
      feedback={feedback}
      disabled={disabled}
      disabledReason="Example of a disabled reason"
      accessibilityLabel={`${feedback} ${count}`}
      onPress={() => setCount((n) => n + 1)}
      className="rounded-card border border-line px-4"
    >
      <Text role="subhead" tone={disabled ? 'fg-3' : 'fg'}>
        {feedback} · {count}
      </Text>
    </Pressable>
  );
}

function PressableGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Feedback (Android always ripples)">
        <StoryRow>
          <Counter feedback="scale" />
          <Counter feedback="highlight" />
          <Counter feedback="none" />
        </StoryRow>
      </StorySection>
      <StorySection title="Disabled">
        <Counter feedback="scale" disabled />
      </StorySection>
      <StorySection title="Selection haptic, row frame">
        <Pressable frame="none" haptic="selection" accessibilityLabel="Row" onPress={() => undefined} className="min-h-row justify-center px-gutter">
          <Text>A row-sized pressable (min-h-row ≥ the hit target)</Text>
        </Pressable>
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <StoryRow>
            <Counter feedback="scale" />
            <Counter feedback="highlight" />
          </StoryRow>
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Counter feedback="highlight" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Pressable', component: PressableGallery } satisfies Meta<typeof PressableGallery>;
export default meta;
export const Feedback: StoryObj<typeof meta> = {};

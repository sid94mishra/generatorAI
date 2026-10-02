import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Text } from '../Text';
import { CodeText } from './CodeText';

const TS = `export function applyCoupon(total: number, code: string): number {
  // 10 % off, never below zero
  const rate = code === 'SAVE10' ? 0.1 : 0;
  return Math.max(0, total * (1 - rate));
}`;

function CodeTextGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Inline in prose, and an error excerpt">
        <Text role="transcript">
          Run <CodeText form="inline" code="pnpm test checkout" /> again before pushing.
        </Text>
        <Text role="transcript">
          It failed with <CodeText form="inline" tone="err" code="expected total 90, received 100" />.
        </Text>
      </StorySection>
      <StorySection title="Block: highlighted, copy, wrap toggle">
        <CodeText form="block" code={TS} language="ts" copyable />
      </StorySection>
      <StorySection title="Block: command, max 2 lines, error tone">
        <CodeText form="block" code="git push -u origin fix/checkout-flake" language="bash" />
        <CodeText form="block" code={TS} maxLines={2} />
        <CodeText form="block" tone="err" code={`× applies coupon · 4 of 20 failed\nexpected total 90, received 100`} />
      </StorySection>
      <StorySection title="Long line (scrolls; wrap toggles)">
        <CodeText form="block" code={`${LONG_TEXT} ${LONG_TEXT}`} />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <CodeText form="block" code={TS} language="ts" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/CodeText', component: CodeTextGallery } satisfies Meta<typeof CodeTextGallery>;
export default meta;
export const Forms: StoryObj<typeof meta> = {};

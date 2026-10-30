import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { ComposerField } from './ComposerField';
import { ComposerSurface } from './ComposerSurface';

function Field({ initial = '' }: { initial?: string }): React.ReactElement {
  const [text, setText] = useState(initial);
  return (
    <ComposerSurface>
      <ComposerField value={text} onChangeText={setText} placeholder="Reply to Bug Fixer…" accessibilityLabel="Message Bug Fixer" />
    </ComposerSurface>
  );
}

function ComposerFieldGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Empty · long text (grows to 8 lines, then scrolls) · font scale 2">
        <Field />
        <Field initial={LONG_TEXT.repeat(3)} />
        <WithFontScale scale={2}>
          <Field initial="Large text" />
        </WithFontScale>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Field />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/ComposerField', component: ComposerFieldGallery } satisfies Meta<typeof ComposerFieldGallery>;
export default meta;
export const Field_: StoryObj<typeof meta> = { name: 'Field' };

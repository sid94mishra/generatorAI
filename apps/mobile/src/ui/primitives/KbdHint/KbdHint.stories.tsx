import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { setHardwareKeyboardAttached } from '../../platform/keyboard';
import { KbdHint } from './KbdHint';

function KbdHintGallery(): React.ReactElement {
  React.useEffect(() => {
    setHardwareKeyboardAttached(true);
    return () => setHardwareKeyboardAttached(false);
  }, []);
  return (
    <StoryPage>
      <StorySection title="Shown with a hardware keyboard (forced on in this story)">
        <StoryRow>
          <KbdHint binding="Mod+K" />
          <KbdHint binding="Mod+N" />
          <KbdHint binding="Shift+Enter" />
          <KbdHint binding="Escape" />
        </StoryRow>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <KbdHint binding="Mod+K" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/KbdHint', component: KbdHintGallery } satisfies Meta<typeof KbdHintGallery>;
export default meta;
export const Chords: StoryObj<typeof meta> = {};

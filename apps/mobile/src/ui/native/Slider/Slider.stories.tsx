import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Slider } from './Slider';
import type { SliderProps } from './Slider.types';
import { SliderJs } from './SliderJs';

function Live({ initial, js, ...rest }: Omit<SliderProps, 'value' | 'onValueChange'> & { initial: number; js?: boolean }): React.ReactElement {
  const [value, setValue] = useState(initial);
  const Control = js ? SliderJs : Slider;
  return <Control {...rest} value={value} onValueChange={setValue} />;
}

function SliderGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Stepped with text-size glyphs and value (MSetBrowserTerminal), continuous, disabled">
        <Live label="Terminal font size" initial={13} min={10} max={20} step={1} minIcon="zoom-out" maxIcon="zoom-in" valueText={(v) => `${v} pt`} />
        <Live label="Volume" initial={0.6} min={0} max={1} valueText={(v) => `${Math.round(v * 100)} %`} />
        <Live label="Volume" initial={0.3} min={0} max={1} disabled />
      </StorySection>
      <StorySection title="JS path (Jest, web, clients without Expo UI)">
        <Live js label="Terminal font size" initial={13} min={10} max={20} step={1} valueText={(v) => `${v} pt`} />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <Live label="Terminal font size" initial={13} min={10} max={20} step={1} valueText={(v) => `${v} pt`} />
        </WithFontScale>
        <RightToLeft>
          <Live label="Terminal font size" initial={13} min={10} max={20} step={1} valueText={(v) => `${v} pt`} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix (JS path)">
        <ThemeMatrix>
          <Live js label="Volume" initial={0.6} min={0} max={1} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Native/Slider', component: SliderGallery } satisfies Meta<typeof SliderGallery>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};

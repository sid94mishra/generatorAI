import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { NumberField } from './NumberField';
import type { NumberFieldProps } from './NumberField.types';

function Live(props: Omit<NumberFieldProps, 'value' | 'onValueChange'> & { initial: number }): React.ReactElement {
  const [value, setValue] = useState(props.initial);
  return <NumberField {...props} value={value} onValueChange={setValue} />;
}

function NumberFieldGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Default, at min, at max, formatted, fractional step, disabled">
        <Live label="Max turns" initial={20} min={1} max={100} />
        <Live label="Concurrency" initial={1} min={1} max={8} />
        <Live label="Concurrency" initial={8} min={1} max={8} />
        <Live label="Keep workspaces" initial={4} min={1} max={64} format={(v) => `${v} GB`} />
        <Live label="Temperature" initial={0.7} min={0} max={1} step={0.1} />
        <Live label="Retries" initial={3} disabled />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <Live label="Max turns" initial={20} min={1} max={100} />
        </WithFontScale>
        <RightToLeft>
          <Live label="Max turns" initial={20} min={1} max={100} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Live label="Max turns" initial={20} min={1} max={100} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/NumberField', component: NumberFieldGallery } satisfies Meta<typeof NumberFieldGallery>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};

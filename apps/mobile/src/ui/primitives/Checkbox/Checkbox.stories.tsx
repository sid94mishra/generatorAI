import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Checkbox } from './Checkbox';
import type { CheckboxProps } from './Checkbox.types';

function Live({ initial, ...rest }: Omit<CheckboxProps, 'checked' | 'onValueChange'> & { initial: CheckboxProps['checked'] }): React.ReactElement {
  const [checked, setChecked] = useState(initial);
  return <Checkbox {...rest} checked={checked} onValueChange={setChecked} />;
}

function CheckboxGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Unchecked, checked, indeterminate (box only)">
        <StoryRow>
          <Live initial={false} accessibilityLabel="Select chat" />
          <Live initial accessibilityLabel="Select chat" />
          <Live initial="indeterminate" accessibilityLabel="Select all" />
        </StoryRow>
      </StorySection>
      <StorySection title="With label, disabled">
        <Live initial={false} label="Read files" />
        <Live initial label="Write files" />
        <Live initial label="Network access" disabled />
        <Live initial={false} label="Run shell commands" disabled />
      </StorySection>
      <StorySection title="Long label, font scale 2.0, right to left">
        <Live initial label={LONG_TEXT} />
        <WithFontScale scale={2}>
          <Live initial label="Write files" />
        </WithFontScale>
        <RightToLeft>
          <Live initial label="Write files" />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StoryRow>
            <Live initial={false} accessibilityLabel="a" />
            <Live initial accessibilityLabel="b" />
            <Live initial="indeterminate" accessibilityLabel="c" />
          </StoryRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Checkbox', component: CheckboxGallery } satisfies Meta<typeof CheckboxGallery>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};

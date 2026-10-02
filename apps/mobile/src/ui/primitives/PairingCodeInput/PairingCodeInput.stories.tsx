import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { PairingCodeInput } from './PairingCodeInput';
import type { PairingCodeInputProps } from './PairingCodeInput.types';

function Live(props: Omit<PairingCodeInputProps, 'value' | 'onChangeText'> & { initial?: string }): React.ReactElement {
  const [value, setValue] = useState(props.initial ?? '');
  return <PairingCodeInput {...props} value={value} onChangeText={setValue} />;
}

function PairingCodeInputGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Empty, partly typed, complete">
        <Live />
        <Live initial="4F7K" />
        <Live initial="4F7K2QX9MB3T" />
      </StorySection>
      <StorySection title="Error (server message), disabled, read-only display (Settings › Pair a device)">
        <Live initial="4F7K2QX9MB3T" error="That code expired — ask for a new one" />
        <Live initial="4F7K2Q" disabled />
        <Live initial="4F7K2QX9MB3T" readOnly />
      </StorySection>
      <StorySection title="Font scale 2.0 (cells cap at the chrome scale), right to left">
        <WithFontScale scale={2}>
          <Live initial="4F7K2QX9MB3T" />
        </WithFontScale>
        <RightToLeft>
          <Live initial="4F7K2Q" />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Live initial="4F7K2Q" />
          <Live initial="4F7K2QX9MB3T" error="That code expired — ask for a new one" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/PairingCodeInput', component: PairingCodeInputGallery } satisfies Meta<typeof PairingCodeInputGallery>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};

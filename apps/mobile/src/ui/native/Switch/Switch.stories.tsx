import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Switch } from './Switch';
import type { SwitchProps } from './Switch.types';
import { SwitchJs } from './SwitchJs';

function Live({ initial, js, ...rest }: Omit<SwitchProps, 'value' | 'onValueChange'> & { initial: boolean; js?: boolean }): React.ReactElement {
  const [value, setValue] = useState(initial);
  const Control = js ? SwitchJs : Switch;
  return <Control {...rest} value={value} onValueChange={setValue} />;
}

function SwitchGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Native (SwiftUI Toggle / M3 Switch): off, on, disabled off / on, pending">
        <StoryRow>
          <Live initial={false} label="Notifications" />
          <Live initial label="Notifications" />
          <Live initial={false} label="Notifications" disabled />
          <Live initial label="Notifications" disabled />
          <Live initial label="Notifications" pending />
        </StoryRow>
      </StorySection>
      <StorySection title="JS path (Jest, web, clients without Expo UI)">
        <StoryRow>
          <Live js initial={false} label="Notifications" />
          <Live js initial label="Notifications" />
          <Live js initial label="Notifications" disabled />
        </StoryRow>
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <StoryRow>
            <Live initial label="Notifications" />
          </StoryRow>
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix (accent = on colour)">
        <ThemeMatrix>
          <StoryRow>
            <Live initial={false} label="a" />
            <Live initial label="b" />
          </StoryRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Native/Switch', component: SwitchGallery } satisfies Meta<typeof SwitchGallery>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};

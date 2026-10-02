import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { DatePicker } from './DatePicker';
import type { DatePickerProps } from './DatePicker.types';
import { DatePickerJs } from './DatePickerJs';

const AT_TWO = new Date(2026, 9, 2, 2, 0);

function Live({ js, ...rest }: Omit<DatePickerProps, 'value' | 'onValueChange'> & { js?: boolean }): React.ReactElement {
  const [value, setValue] = useState(AT_TWO);
  const Control = js ? DatePickerJs : DatePicker;
  return <Control {...rest} value={value} onValueChange={setValue} />;
}

function DatePickerGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Time (MAutomationCreate2: 02:00, 15-minute steps), date with a range, date and time">
        <Live mode="time" label="Run at" minuteInterval={15} />
        <Live mode="date" label="Start on" minimumDate={AT_TWO} />
        <Live mode="datetime" label="Expires" timeZone="UTC" />
      </StorySection>
      <StorySection title="iOS wheel (inside sheets)">
        <Live mode="time" label="Run at" display="wheel" />
      </StorySection>
      <StorySection title="JS path (Jest, web, clients without Expo UI)">
        <Live js mode="datetime" label="Expires" />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <Live js mode="datetime" label="Expires" />
        </WithFontScale>
        <RightToLeft>
          <Live mode="date" label="Start on" />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Live js mode="time" label="Run at" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Native/DatePicker', component: DatePickerGallery } satisfies Meta<typeof DatePickerGallery>;
export default meta;
export const AllModes: StoryObj<typeof meta> = {};

import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { SearchInput } from './SearchInput';
import type { SearchInputProps } from './SearchInput.types';

const noop = (): void => undefined;

function Live(props: Omit<SearchInputProps, 'value' | 'onChangeText'> & { initial?: string }): React.ReactElement {
  const [value, setValue] = useState(props.initial ?? '');
  return <SearchInput {...props} value={value} onChangeText={setValue} />;
}

function SearchInputGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Bar (top level): empty with mic, filled (clear), loading">
        <Live placeholder="Search chats" mic onMicPress={noop} />
        <Live placeholder="Search chats" initial="checkout" />
        <Live placeholder="Search chats" initial="checkout" loading />
      </StorySection>
      <StorySection title="Compact (sheets, drawer)">
        <Live placeholder="Search agents" size="compact" />
        <Live placeholder="Search agents" size="compact" initial="bug" />
      </StorySection>
      <StorySection title="Button mode (drawer search → palette)">
        <SearchInput asButton placeholder="Search chats, runs, commands" value="" onChangeText={noop} onPress={noop} />
      </StorySection>
      <StorySection title="Long text, font scale 2.0, right to left">
        <Live placeholder={LONG_TEXT} />
        <WithFontScale scale={2}>
          <Live placeholder="Search chats" initial="checkout" />
        </WithFontScale>
        <RightToLeft>
          <Live placeholder="Search chats" initial="checkout" />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Live placeholder="Search chats" mic onMicPress={noop} />
          <Live placeholder="Search agents" size="compact" initial="bug" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/SearchInput', component: SearchInputGallery } satisfies Meta<typeof SearchInputGallery>;
export default meta;
export const AllVariants: StoryObj<typeof meta> = {};

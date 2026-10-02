import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Text } from './Text';
import type { TextRole, TextTone } from './Text.types';

const ROLES: TextRole[] = ['largeTitle', 'title', 'headline', 'detailTitle', 'body', 'transcript', 'subhead', 'footnote', 'caption', 'monoLg', 'mono', 'monoSm'];
const TONES: TextTone[] = ['fg', 'fg-2', 'fg-3', 'run', 'ok', 'warn', 'err'];

function Ramp(): React.ReactElement {
  return (
    <>
      {ROLES.map((role) => (
        <Text key={role} role={role}>
          {role} · The quick brown fox 0123
        </Text>
      ))}
    </>
  );
}

function TextGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Roles (02 §4.1)">
        <Ramp />
      </StorySection>
      <StorySection title="Tones">
        {TONES.map((tone) => (
          <Text key={tone} role="subhead" tone={tone}>
            {tone}
          </Text>
        ))}
      </StorySection>
      <StorySection title="Weights">
        <Text weight={400}>Regular 400</Text>
        <Text weight={500}>Medium 500</Text>
        <Text weight={600}>Semibold 600</Text>
      </StorySection>
      <StorySection title="Long text, truncation">
        <Text>{LONG_TEXT}</Text>
        <Text numberOfLines={1}>{LONG_TEXT}</Text>
        <Text role="mono" numberOfLines={1} ellipsizeMode="middle">
          src/very/deep/path/to/a/file/that/needs/middle/truncation/index.ts
        </Text>
      </StorySection>
      <StorySection title="Font scale 2.0 (caps: largeTitle 1.3, title 1.4, headline 1.6, chrome 1.4)">
        <WithFontScale scale={2}>
          <Text role="largeTitle">Large title</Text>
          <Text role="headline">Headline</Text>
          <Text role="body">Body scales fully</Text>
          <Text role="caption" chrome>
            Chrome caption
          </Text>
        </WithFontScale>
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <Text>{LONG_TEXT}</Text>
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Text role="headline">Headline</Text>
          <Text tone="fg-2">Secondary text</Text>
          <Text role="caption" tone="fg-3">
            Caption
          </Text>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Text', component: TextGallery } satisfies Meta<typeof TextGallery>;
export default meta;
export const AllRoles: StoryObj<typeof meta> = {};

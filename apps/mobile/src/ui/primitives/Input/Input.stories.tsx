import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Badge } from '../Badge';
import { Field } from '../Field';
import type { InputKind, InputProps } from './Input.types';
import { Input } from './Input';

function Live(props: Omit<InputProps, 'value' | 'onChangeText'> & { initial?: string }): React.ReactElement {
  const [value, setValue] = useState(props.initial ?? '');
  return <Input {...props} value={value} onChangeText={setValue} />;
}

const KINDS: InputKind[] = ['text', 'secret', 'mono', 'url', 'email', 'number'];

function InputGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Row presentation (iOS; Android draws outlined) — inside a group">
        <View className="rounded-group bg-raised">
          <Live label="Name" initial="Nightly audit" />
          <Live label="Token" kind="secret" initial="ghp_example" />
          <Live label="Branch" kind="mono" placeholder="main" />
        </View>
      </StorySection>
      <StorySection title="Standalone, every kind">
        {KINDS.map((kind) => (
          <Live key={kind} label={`Kind: ${kind}`} kind={kind} presentation="standalone" placeholder={kind === 'url' ? 'https://' : 'Type here'} />
        ))}
      </StorySection>
      <StorySection title="States: filled, trailing status, error (in a Field), disabled, read-only, leading icon">
        <Live label="Server address" kind="url" presentation="standalone" initial="http://192.168.1.24:3100" trailing={<Badge label="Reachable" size="sm" />} />
        <Field error="Use an http or https address">
          <Live label="Webhook URL" kind="url" presentation="standalone" initial="ftp://nope" error="Use an http or https address" />
        </Field>
        <Live label="Workspace" presentation="standalone" initial="payments-service" disabled />
        <Live label="Device id" kind="mono" presentation="standalone" initial="dev_7f3a9c" readOnly />
        <Live label="Search files" presentation="standalone" leadingIcon="search" />
      </StorySection>
      <StorySection title="Long text, font scale 2.0, right to left">
        <Live label="Description" presentation="standalone" initial={LONG_TEXT} />
        <WithFontScale scale={2}>
          <Live label="Name" presentation="standalone" initial="Nightly audit" />
        </WithFontScale>
        <RightToLeft>
          <Live label="Name" presentation="standalone" initial="Nightly audit" />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Live label="Name" presentation="standalone" initial="Nightly audit" />
          <Live label="Webhook URL" presentation="standalone" kind="url" initial="ftp://nope" error="Invalid" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Input', component: InputGallery } satisfies Meta<typeof InputGallery>;
export default meta;
export const AllVariants: StoryObj<typeof meta> = {};

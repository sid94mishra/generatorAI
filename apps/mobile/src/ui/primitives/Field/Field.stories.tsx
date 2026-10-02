import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Badge } from '../Badge';
import { Checkbox } from '../Checkbox';
import { Input } from '../Input';
import { Field } from './Field';

function Name({ error }: { error?: string }): React.ReactElement {
  const [value, setValue] = useState('Nightly audit');
  return <Input label="Name" presentation="standalone" value={value} onChangeText={setValue} error={error} />;
}

function Agree(): React.ReactElement {
  const [on, setOn] = useState(false);
  return <Checkbox checked={on} onValueChange={setOn} label="Allow network access" />;
}

function FieldGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Help, error, required, provenance">
        <Field help="Shown in the sidebar and in notifications.">
          <Name />
        </Field>
        <Field error="A name is required" required>
          <Name error="A name is required" />
        </Field>
        <Field label="Permissions" required provenance={<Badge label="Changed" icon="undo" size="sm" />} help="The agent asks before anything else.">
          <Agree />
        </Field>
      </StorySection>
      <StorySection title="Long help, font scale 2.0, right to left">
        <Field help={LONG_TEXT}>
          <Name />
        </Field>
        <WithFontScale scale={2}>
          <Field help="Shown in the sidebar.">
            <Name />
          </Field>
        </WithFontScale>
        <RightToLeft>
          <Field error="A name is required">
            <Name error="A name is required" />
          </Field>
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Field error="A name is required">
            <Name error="A name is required" />
          </Field>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Field', component: FieldGallery } satisfies Meta<typeof FieldGallery>;
export default meta;
export const AllStates: StoryObj<typeof meta> = {};

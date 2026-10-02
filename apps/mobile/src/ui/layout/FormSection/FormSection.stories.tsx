import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Input } from '../../primitives/Input';
import { Textarea } from '../../primitives/Textarea';
import { FormSection } from './FormSection';

function Fields({ row }: { row?: boolean }): React.ReactElement {
  const [name, setName] = useState('github');
  const [url, setUrl] = useState('https://mcp.example.dev');
  const presentation = row ? 'row' : 'standalone';
  return (
    <FormSection title="Server" hint="Shown in the agent's tool list." variant={row ? 'grouped' : 'stacked'}>
      <Input label="Name" presentation={presentation} value={name} onChangeText={setName} />
      <Input label="URL" kind="url" presentation={presentation} value={url} onChangeText={setUrl} />
    </FormSection>
  );
}

function FormSectionGallery(): React.ReactElement {
  const [notes, setNotes] = useState('');
  return (
    <StoryPage>
      <StorySection title="Grouped (iOS row fields) and stacked (outlined / standalone fields)">
        <Fields row />
        <Fields />
        <FormSection title="Notes" variant="stacked">
          <Textarea label="Notes" value={notes} onChangeText={setNotes} />
        </FormSection>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Fields row />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/FormSection', component: FormSectionGallery } satisfies Meta<typeof FormSectionGallery>;
export default meta;
export const Sections: StoryObj<typeof meta> = {};

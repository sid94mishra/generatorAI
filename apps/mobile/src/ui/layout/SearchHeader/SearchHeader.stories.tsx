import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { SearchHeader } from './SearchHeader';

function Live({ initial = '', count, loading = false }: { initial?: string; count?: number; loading?: boolean }): React.ReactElement {
  const [value, setValue] = useState(initial);
  return <SearchHeader value={value} onChangeText={setValue} placeholder="Search chats, runs, commands" onClose={() => undefined} resultCount={count} loading={loading} />;
}

function SearchHeaderGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Empty (iOS field + glass ✕ / Android M3 search view header)">
        <Live />
      </StorySection>
      <StorySection title="Typed with a result count; searching">
        <Live initial="run nig" count={9} />
        <Live initial="run nig" loading />
      </StorySection>
      <StorySection title="Font scale 1.6">
        <WithFontScale scale={1.6}>
          <Live initial="audit" count={1} />
        </WithFontScale>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Live initial="run" count={3} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/SearchHeader', component: SearchHeaderGallery } satisfies Meta<typeof SearchHeaderGallery>;
export default meta;
export const States: StoryObj<typeof meta> = {};

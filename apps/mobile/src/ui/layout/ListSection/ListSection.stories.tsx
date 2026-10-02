import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { ListRow } from '../ListRow';
import { ListSection } from './ListSection';

const noop = (): void => undefined;
const ROWS = [
  { icon: 'mcp', title: 'Model providers', value: '1 of 2 connected' },
  { icon: 'agents', title: 'Agents', value: '5 of 6' },
  { icon: 'skills', title: 'Skills', value: '4 of 5' },
] as const;

function Section(props: Omit<React.ComponentProps<typeof ListSection>, 'children'>): React.ReactElement {
  return (
    <ListSection {...props}>
      {ROWS.map((r) => (
        <ListRow key={r.title} kind="navigation" icon={r.icon} title={r.title} value={r.value} onPress={noop} />
      ))}
    </ListSection>
  );
}

function ListSectionGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Grouped (iOS inset / Android flat): title + count + action, footer">
        <Section title="Agents & models" count={3} action={{ label: 'See all', onPress: noop }} footer="Providers sign in on the server." />
      </StorySection>
      <StorySection title="Dividers full, none; no title">
        <Section dividers="full" />
        <Section dividers="none" />
      </StorySection>
      <StorySection title="Carded (Android M3 segmented list; iOS same as grouped)">
        <Section title="Capabilities" variant="carded" />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Section title="Agents & models" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/ListSection', component: ListSectionGallery } satisfies Meta<typeof ListSectionGallery>;
export default meta;
export const Variants: StoryObj<typeof meta> = {};

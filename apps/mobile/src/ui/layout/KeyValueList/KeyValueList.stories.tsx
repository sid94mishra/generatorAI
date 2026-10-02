import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { StatusBadge } from '../../primitives/StatusBadge';
import { KeyValueList } from './KeyValueList';

const ITEMS = [
  { label: 'Server', value: 'local:3100', mono: true, copyable: true },
  { label: 'Version', value: '0.42.1', mono: true },
  { label: 'Status', value: <StatusBadge state="succeeded" size="sm" /> },
  { label: 'Webhook', value: 'https://hooks.example.dev/automations/nightly-dependency-audit', mono: true, copyable: true },
  { label: 'Notes', value: LONG_TEXT },
];

function KeyValueListGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Diagnostics-style rows: mono, copyable, element value, long text">
        <KeyValueList items={ITEMS} />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <KeyValueList items={ITEMS.slice(0, 2)} />
        </WithFontScale>
        <RightToLeft>
          <KeyValueList items={ITEMS.slice(0, 2)} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <KeyValueList items={ITEMS.slice(0, 3)} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/KeyValueList', component: KeyValueListGallery } satisfies Meta<typeof KeyValueListGallery>;
export default meta;
export const Rows: StoryObj<typeof meta> = {};

import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Button } from '../../primitives/Button';
import { BulkActionBar } from './BulkActionBar';

const noop = (): void => undefined;
const ACTIONS = [
  { id: 'archive', label: 'Archive', icon: 'archive' as const, onPress: noop },
  { id: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: noop, testID: 'chats-bulk-delete' },
  { id: 'more', label: 'More', icon: 'more' as const, onPress: noop },
];

function Live(): React.ReactElement {
  const [count, setCount] = useState(2);
  return (
    <>
      <Button label="Select one more" size="sm" onPress={() => setCount((c) => c + 1)} />
      <BulkActionBar count={count} actions={ACTIONS} onSelectAll={() => setCount(12)} onCancel={() => setCount(0)} />
    </>
  );
}

function BulkActionBarGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Selection mode (count announced on change); a disabled action">
        <Live />
        <BulkActionBar count={0} actions={ACTIONS.map((a) => ({ ...a, disabled: true }))} onSelectAll={noop} onCancel={noop} />
      </StorySection>
      <StorySection title="Font scale 2.0">
        <WithFontScale scale={2}>
          <BulkActionBar count={3} actions={ACTIONS} onSelectAll={noop} onCancel={noop} />
        </WithFontScale>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <BulkActionBar count={3} actions={ACTIONS} onSelectAll={noop} onCancel={noop} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/BulkActionBar', component: BulkActionBarGallery } satisfies Meta<typeof BulkActionBarGallery>;
export default meta;
export const Selection: StoryObj<typeof meta> = {};

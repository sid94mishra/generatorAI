import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Button } from '../../primitives/Button';
import { Icon } from '../../primitives/Icon';
import { Text } from '../../primitives/Text';
import { ReorderList } from './ReorderList';

interface Stage {
  id: string;
  name: string;
  locked?: boolean;
}

const STAGES: Stage[] = [
  { id: 'triage', name: 'Triage the report' },
  { id: 'repro', name: 'Reproduce' },
  { id: 'fix', name: 'Write the fix' },
  { id: 'verify', name: 'Verify', locked: true },
];

function Builder(): React.ReactElement {
  const [stages, setStages] = useState(STAGES);
  const [editing, setEditing] = useState(true);
  return (
    <View className="gap-3">
      <Button label={editing ? 'Done' : 'Edit order'} size="sm" onPress={() => setEditing((v) => !v)} />
      <View className="h-80 overflow-hidden rounded-group bg-raised">
        <ReorderList
          data={stages}
          keyExtractor={(s) => s.id}
          itemName={(s) => s.name}
          editing={editing}
          canMove={(from, to) => !stages[from]?.locked && !stages[to]?.locked}
          header={<Text role="footnote" tone="fg-3" className="px-4 py-2">Header scrolls with the rows</Text>}
          footer={<Text role="footnote" tone="fg-3" className="px-4 py-2">Footer: a settings row</Text>}
          onMove={(key, to) =>
            setStages((list) => {
              const from = list.findIndex((s) => s.id === key);
              const next = [...list];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved!);
              return next;
            })
          }
          renderItem={(s, handle) => (
            <View className="min-h-row flex-row items-center gap-3 ps-4 pe-1">
              <Icon concept={s.locked ? 'lock' : 'workflows'} size={20} tone="fg-2" />
              <Text role="body" className="flex-1">
                {s.name}
              </Text>
              {handle}
            </View>
          )}
        />
      </View>
    </View>
  );
}

function ReorderListGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Builder stages: drag the grip (lift + haptics); the locked stage cannot move (canMove)">
        <Builder />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Builder />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/ReorderList', component: ReorderListGallery } satisfies Meta<typeof ReorderListGallery>;
export default meta;
export const BuilderStages: StoryObj<typeof meta> = {};

import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StoryRow, StorySection } from '../../storybook/StoryKit';
import { Button } from '../../primitives/Button';
import { Input } from '../../primitives/Input';
import { Text } from '../../primitives/Text';
import { useDirtyGuard } from './useDirtyGuard';

function Form(): React.ReactElement {
  const [name, setName] = useState('Nightly audit');
  const [saved, setSaved] = useState('Nightly audit');
  const [closed, setClosed] = useState(0);
  const dirty = name !== saved;
  const { guard } = useDirtyGuard(dirty, { onDiscard: () => setName(saved) });
  return (
    <>
      <Input label="Name" presentation="standalone" value={name} onChangeText={setName} />
      <StoryRow>
        <Button label="Cancel (guarded)" onPress={() => void guard(() => setClosed((c) => c + 1))} />
        <Button label="Save" variant="primary" onPress={() => setSaved(name)} disabled={!dirty} />
      </StoryRow>
      <Text role="footnote" tone="fg-3">{`${dirty ? 'Dirty' : 'Clean'} · closed ${closed}× · Android Back while dirty asks too`}</Text>
    </>
  );
}

function DirtyGuardGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Edit the name, then Cancel: “Discard changes?” — Keep editing / Discard">
        <Form />
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/DirtyGuard', component: DirtyGuardGallery } satisfies Meta<typeof DirtyGuardGallery>;
export default meta;
export const GuardedForm: StoryObj<typeof meta> = {};

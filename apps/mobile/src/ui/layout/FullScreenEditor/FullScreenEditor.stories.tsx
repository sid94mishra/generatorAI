import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, ThemeMatrix } from '../../storybook/StoryKit';
import { Button } from '../../primitives/Button';
import { Field } from '../../primitives/Field';
import { Input } from '../../primitives/Input';
import { Text } from '../../primitives/Text';
import { Textarea } from '../../primitives/Textarea';
import { FullScreenEditor } from './FullScreenEditor';

const noop = (): void => undefined;

function AgentEditor({ long = false }: { long?: boolean }): React.ReactElement {
  const [name, setName] = useState('Bug Fixer');
  const [instructions, setInstructions] = useState('Reproduce, fix, verify.');
  const [saving, setSaving] = useState(false);
  const changes = Number(name !== 'Bug Fixer') + Number(instructions !== 'Reproduce, fix, verify.');
  return (
    <FullScreenEditor
      title={long ? LONG_TEXT : 'Edit agent'}
      primary={{ label: 'Save', onPress: () => setSaving(true), disabled: changes === 0, loading: saving }}
      onCancel={noop}
      dirty={changes > 0}
      dirtyCount={changes}
      stickyBar={
        <View className="flex-row gap-3 px-4 py-3">
          <Button label="Back" onPress={noop} />
          <Button label="Continue" variant="primary" onPress={noop} />
        </View>
      }
    >
      <Field help="Shown in pickers and chat headers.">
        <Input label="Name" presentation="standalone" value={name} onChangeText={setName} />
      </Field>
      <Textarea label="Instructions" value={instructions} onChangeText={setInstructions} />
    </FullScreenEditor>
  );
}

/** A wizard: Cancel only in the header; the sticky bar carries Back · Continue (MD-85). */
function WizardFrame(): React.ReactElement {
  return (
    <FullScreenEditor title="New automation" onCancel={noop} dirty stickyBar={<View className="flex-row justify-between px-4 py-3"><Button label="Back" onPress={noop} /><Button label="Continue" variant="primary" onPress={noop} /></View>}>
      <Input label="Name" presentation="standalone" value="Nightly audit" onChangeText={noop} />
    </FullScreenEditor>
  );
}

function FullScreenEditorGallery(): React.ReactElement {
  return (
    <View className="flex-1 bg-surface">
      <View className="flex-1">
        <AgentEditor />
      </View>
      <View className="h-80">
        <ThemeMatrix>
          <View className="h-40">
            <AgentEditor long />
          </View>
        </ThemeMatrix>
      </View>
    </View>
  );
}

const meta = { title: 'UI/Layout/FullScreenEditor', component: FullScreenEditorGallery } satisfies Meta<typeof FullScreenEditorGallery>;
export default meta;
export const AgentEditorFrame: StoryObj<typeof meta> = {};

export const Wizard: StoryObj<typeof meta> = { render: () => <WizardFrame /> };
export const FixedBody: StoryObj<typeof meta> = {
  render: () => (
    <FullScreenEditor title="Edit workflow" primary={{ label: 'Save', onPress: noop }} onCancel={noop} dirty={false} body="fixed">
      <View className="flex-1 gap-2 px-gutter">
        <Text role="body">A list owns scrolling here (the builder's ReorderList).</Text>
      </View>
    </FullScreenEditor>
  ),
};

import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Button } from '../../primitives/Button';
import { Input } from '../../primitives/Input';
import { RadioGroup, RadioOption } from '../../primitives/RadioGroup';
import { Text } from '../../primitives/Text';
import { Sheet } from './Sheet';
import { SheetModal, SheetProvider, useSheet } from './SheetJs';

const noop = (): void => undefined;

function ModelPicker({ onDone }: { onDone: () => void }): React.ReactElement {
  const [value, setValue] = useState<string | null>('sonnet');
  return (
    <RadioGroup value={value} onValueChange={setValue} accessibilityLabel="Model">
      <RadioOption value="sonnet" label="Claude Sonnet 5" description="Balanced" />
      <RadioOption value="opus" label="Claude Opus 5.5" description="Most capable" />
      <RadioOption value="haiku" label="Claude Haiku 5" description="Fastest" />
      <View className="px-4 pt-2">
        <Button label="Close" variant="ghost" onPress={onDone} />
      </View>
    </RadioGroup>
  );
}

function RenameForm(): React.ReactElement {
  const [name, setName] = useState('Fix flaky checkout test');
  const [open, setOpen] = useState(false);
  const dirty = name !== 'Fix flaky checkout test';
  return (
    <>
      <Button label="Rename (action sheet, content detent, dirty guard)" onPress={() => setOpen(true)} />
      <SheetModal
        open={open}
        title="Rename chat"
        detents={['content']}
        dirty={dirty}
        onDismiss={() => setOpen(false)}
        footer={<Button label="Save" variant="primary" size="lg" fullWidth onPress={() => setOpen(false)} />}
      >
        <View className="px-4">
          <Input label="Name" presentation="standalone" value={name} onChangeText={setName} autoFocus />
        </View>
      </SheetModal>
    </>
  );
}

function Pages(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<'main' | 'model'>('main');
  return (
    <>
      <Button label="New chat (pages inside one sheet, MD-62)" onPress={() => setOpen(true)} />
      <SheetModal
        open={open}
        title={page === 'main' ? 'New chat' : 'Model'}
        detents={['large']}
        back={page === 'model' ? { label: 'New chat', onPress: () => setPage('main') } : undefined}
        onDismiss={() => setOpen(false)}
        footer={page === 'main' ? <Button label="Create chat" variant="primary" size="lg" fullWidth onPress={() => setOpen(false)} /> : undefined}
        headerAction={page === 'model' ? { label: 'Done', onPress: () => setPage('main') } : undefined}
      >
        {page === 'main' ? (
          <View className="gap-3 px-4">
            <Text role="body">Who works on this, model, mode…</Text>
            <Button label="Model: Claude Sonnet 5" trailingIcon="chevron-right" onPress={() => setPage('model')} />
          </View>
        ) : (
          <ModelPicker onDone={() => setPage('main')} />
        )}
      </SheetModal>
    </>
  );
}

function Imperative(): React.ReactElement {
  const sheet = useSheet();
  return (
    <Button
      label="useSheet().present (selection sheet, medium → large)"
      onPress={() => sheet.present(<ModelPicker onDone={sheet.dismiss} />, { title: 'Model', subtitle: 'Applies to this chat', headerAction: { label: 'Done', onPress: sheet.dismiss } })}
    />
  );
}

function SheetGallery(): React.ReactElement {
  return (
    <SheetProvider>
      <StoryPage>
        <StorySection title="Imperative sheets (JS host until TrueSheet lands, MD-131)">
          <Imperative />
          <RenameForm />
          <Pages />
        </StorySection>
        <StorySection title="Sheet frame (as a route sheet body): selection header, long title">
          <View className="rounded-dialog bg-overlay">
            <Sheet title="Turn setup" headerAction={{ label: 'Done', onPress: noop }} onDismiss={noop}>
              <Text role="body" className="px-4">
                Model · Mode · Effort rows go here.
              </Text>
            </Sheet>
          </View>
          <View className="rounded-dialog bg-overlay">
            <Sheet title={LONG_TEXT} subtitle="payments-service" onDismiss={noop}>
              <Text role="body" className="px-4">
                Body
              </Text>
            </Sheet>
          </View>
        </StorySection>
        <StorySection title="Theme matrix">
          <ThemeMatrix>
            <View className="rounded-dialog bg-overlay">
              <Sheet title="Commit & pull request" onDismiss={noop} footer={<Button label="Commit" variant="primary" size="lg" fullWidth onPress={noop} />}>
                <Text role="body" className="px-4">
                  3 files changed
                </Text>
              </Sheet>
            </View>
          </ThemeMatrix>
        </StorySection>
      </StoryPage>
    </SheetProvider>
  );
}

const meta = { title: 'UI/Native/Sheet', component: SheetGallery } satisfies Meta<typeof SheetGallery>;
export default meta;
export const AllKinds: StoryObj<typeof meta> = {};

import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Button } from '../Button';
import { Text } from '../Text';
import { Toast, ToastHost } from './Toast';
import type { ToastOptions } from './Toast.types';
import { toast } from './toastModel';

const noop = (): void => undefined;
const ARCHIVED: ToastOptions = { kind: 'undo', message: 'Chat archived', icon: 'archive', undo: { onUndo: noop } };
const FAILED: ToastOptions = { kind: 'error', message: "Couldn't archive the chat", action: { label: 'Retry', onPress: noop } };
const DONE: ToastOptions = { kind: 'background', message: 'Nightly audit run succeeded', action: { label: 'Open', onPress: noop } };

function Live(): React.ReactElement {
  const [log, setLog] = useState('—');
  return (
    <>
      <View className="flex-row flex-wrap gap-2">
        <Button label="Undo toast" size="sm" onPress={() => toast({ ...ARCHIVED, undo: { onUndo: () => setLog('undone'), commit: async () => setLog('committed') } })} />
        <Button label="Error toast" size="sm" onPress={() => toast(FAILED)} />
        <Button label="Background toast" size="sm" onPress={() => toast(DONE)} />
      </View>
      <Text role="footnote" tone="fg-3">{`last undo: ${log} (a newer toast replaces the older; its commit still runs)`}</Text>
    </>
  );
}

function ToastGallery(): React.ReactElement {
  return (
    <View className="flex-1">
      <StoryPage>
        <StorySection title="Live host (bottom-centred; swipe iOS down / Android sideways)">
          <Live />
        </StorySection>
        <StorySection title="Kinds: undo, error + Retry, background + Open, long message">
          <Toast options={ARCHIVED} />
          <Toast options={FAILED} />
          <Toast options={DONE} />
          <Toast options={{ kind: 'error', message: LONG_TEXT }} />
        </StorySection>
        <StorySection title="Font scale 2.0, right to left">
          <WithFontScale scale={2}>
            <Toast options={ARCHIVED} />
          </WithFontScale>
          <RightToLeft>
            <Toast options={ARCHIVED} />
          </RightToLeft>
        </StorySection>
        <StorySection title="Theme matrix">
          <ThemeMatrix>
            <Toast options={ARCHIVED} />
            <Toast options={FAILED} />
          </ThemeMatrix>
        </StorySection>
      </StoryPage>
      <ToastHost />
    </View>
  );
}

const meta = { title: 'UI/Primitives/Toast', component: ToastGallery } satisfies Meta<typeof ToastGallery>;
export default meta;
export const AllKinds: StoryObj<typeof meta> = {};

import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { GlassBackdrop, StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { IconButton } from '../../primitives/IconButton';
import { ComposerPrimaryButton } from './ComposerPrimaryButton';
import { ComposerSurface } from './ComposerSurface';

const noop = (): void => undefined;

function Demo({ kind }: { kind: 'send' | 'stop' }): React.ReactElement {
  const [text, setText] = useState('');
  return (
    <ComposerSurface>
      <TextInput value={text} onChangeText={setText} placeholder="Reply to Bug Fixer…" className="text-transcript text-fg" />
      <View className="flex-row items-center gap-2">
        <IconButton icon="plus" label="Add" size="sm" variant="bordered" onPress={noop} />
        <View className="flex-1" />
        <IconButton icon="mic" label="Dictate a message" size="sm" onPress={noop} />
        <ComposerPrimaryButton kind={kind} disabled={kind === 'send' && !text.trim()} disabledReason="Type a message" onPress={noop} />
      </View>
    </ComposerSurface>
  );
}

function ComposerSurfaceGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Idle (Send disabled until text) · running (Stop) — over a backdrop (iOS glass)">
        <GlassBackdrop>
          <View className="gap-4 py-4">
            <Demo kind="send" />
            <Demo kind="stop" />
          </View>
        </GlassBackdrop>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Demo kind="send" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/ComposerSurface', component: ComposerSurfaceGallery } satisfies Meta<typeof ComposerSurfaceGallery>;
export default meta;
export const Surface: StoryObj<typeof meta> = {};

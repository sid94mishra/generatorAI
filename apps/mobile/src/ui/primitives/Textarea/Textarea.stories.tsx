import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Chip } from '../Chip';
import { IconButton } from '../IconButton';
import { Textarea } from './Textarea';
import type { TextareaProps } from './Textarea.types';
import { utf8Bytes } from './textareaModel';

const noop = (): void => undefined;

function Live(props: Omit<TextareaProps, 'value' | 'onChangeText'> & { initial?: string; metered?: number }): React.ReactElement {
  const [value, setValue] = useState(props.initial ?? '');
  const meter = props.metered ? { used: utf8Bytes(value), max: props.metered, unit: 'bytes' as const } : undefined;
  return <Textarea {...props} value={value} onChangeText={setValue} meter={meter} />;
}

const TOOLBAR = (
  <>
    <Chip label="@ Files" variant="add" onPress={noop} />
    <Chip label="/ Skills" variant="add" onPress={noop} />
    <IconButton icon="attach" label="Attach" size="sm" onPress={noop} />
  </>
);

function TextareaGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Standalone: empty, filled, footer toolbar, meter near the limit, error, disabled">
        <Live label="Task" placeholder="Describe the task" />
        <Live label="Description" initial={LONG_TEXT} />
        <Live label="Task" placeholder="What should the agent do?" footer={TOOLBAR} />
        <Live label="Instructions" initial={'x'.repeat(180)} metered={192} />
        <Live label="Reason" initial="" error="Tell the admin why you need it" />
        <Live label="Notes" initial="Read only for now" disabled />
      </StorySection>
      <StorySection title="Row (iOS group), mono">
        <View className="rounded-group bg-raised">
          <Live label="Commit message" presentation="row" placeholder="Summary of the change" />
        </View>
        <Live label="Plan" mono initial={'1. Reproduce\n2. Fix\n3. Verify'} />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <Live label="Task" initial="Fix the flaky checkout test" />
        </WithFontScale>
        <RightToLeft>
          <Live label="Task" initial="Fix the flaky checkout test" />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Live label="Task" initial="Fix the flaky checkout test" metered={32 * 1024} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Textarea', component: TextareaGallery } satisfies Meta<typeof TextareaGallery>;
export default meta;
export const AllVariants: StoryObj<typeof meta> = {};

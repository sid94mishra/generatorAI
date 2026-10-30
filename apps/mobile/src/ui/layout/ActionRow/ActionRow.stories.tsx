import React from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { ActionRow } from './ActionRow';

const noop = (): void => undefined;
const PERMISSION = [
  { id: 'deny', label: 'Deny', role: 'secondary' as const, onPress: noop },
  { id: 'allow', label: 'Allow once', role: 'primary' as const, onPress: noop },
];
const DENYING = [
  { id: 'cancel', label: 'Cancel', role: 'quiet' as const, onPress: noop },
  { id: 'confirm', label: 'Confirm deny', role: 'danger' as const, onPress: noop },
];
const QUESTION = [
  { id: 'skip', label: 'Skip', role: 'quiet' as const, onPress: noop },
  { id: 'next', label: 'Next question', role: 'secondary' as const, onPress: noop },
  { id: 'submit', label: 'Answer', role: 'primary' as const, onPress: noop },
];

function ActionRowGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Permission · deny reason · question (platform layout)">
        <View className="gap-4">
          <ActionRow actions={PERMISSION} />
          <ActionRow actions={DENYING} />
          <ActionRow actions={QUESTION} />
        </View>
      </StorySection>
      <StorySection title="Risky: note · disabled with reason · loading">
        <View className="gap-4">
          <ActionRow actions={PERMISSION} note="Face ID required" />
          <ActionRow actions={[PERMISSION[0]!, { ...PERMISSION[1]!, disabled: true, disabledReason: 'Needs Face ID or a passcode on this device' }]} note="Needs Face ID or a passcode on this device" />
          <ActionRow actions={[PERMISSION[0]!, { ...PERMISSION[1]!, loading: true }]} />
        </View>
      </StorySection>
      <StorySection title="Stacked: large text">
        <WithFontScale scale={1.6}>
          <ActionRow actions={PERMISSION} note="Face ID required" />
        </WithFontScale>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <ActionRow actions={PERMISSION} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/ActionRow', component: ActionRowGallery } satisfies Meta<typeof ActionRowGallery>;
export default meta;
export const Rows: StoryObj<typeof meta> = {};

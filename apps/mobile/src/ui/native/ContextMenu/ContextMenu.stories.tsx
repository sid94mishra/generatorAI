import React from 'react';
import { Alert, View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { MenuEntry } from '../Menu/Menu.types';
import { ContextMenu } from './ContextMenu';
import { ContextMenuJs } from './ContextMenuJs';

const ITEMS: MenuEntry[] = [
  { id: 'pin', label: 'Pin', icon: 'pin' },
  { id: 'pane', label: 'Open workspace pane', icon: 'dock' },
  { id: 'archive', label: 'Archive', icon: 'archive' },
  { type: 'separator' },
  { id: 'delete', label: 'Delete', icon: 'trash', destructive: true },
];

function Row({ title, ...rest }: { title: string; onLongPress?: () => void; accessibilityHint?: string }): React.ReactElement {
  return (
    <Pressable frame="none" onPress={() => Alert.alert('Open', title)} accessibilityLabel={title} className="min-h-row-2 flex-row items-center gap-3 px-4" {...rest}>
      <Icon concept="status-needs-you" tone="warn" />
      <View className="flex-1">
        <Text role="transcript" weight={600}>
          {title}
        </Text>
        <Text role="monoSm" tone="fg-3">
          payments-service · fix/checkout-flake
        </Text>
      </View>
    </Pressable>
  );
}

const PREVIEW = (
  <View className="w-72 gap-1 rounded-card-lg bg-raised p-4">
    <Text role="transcript" weight={600}>
      Fix flaky checkout test
    </Text>
    <Text role="monoSm" tone="fg-3">
      payments-service · fix/checkout-flake
    </Text>
  </View>
);

const show = (id: string): void => Alert.alert('Selected', id);

function ContextMenuGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Long-press a row (iOS system lift; Android anchored menu + highlighted row)">
        <View className="rounded-group bg-raised">
          <ContextMenu items={ITEMS} onSelect={show}>
            <Row title="Fix flaky checkout test" />
          </ContextMenu>
          <ContextMenu items={ITEMS} onSelect={show} preview={PREVIEW}>
            <Row title="With a custom preview (iOS)" />
          </ContextMenu>
          <ContextMenu items={ITEMS} onSelect={show} disabled>
            <Row title="Disabled: no menu" />
          </ContextMenu>
        </View>
      </StorySection>
      <StorySection title="JS path (Jest, web, clients without Expo UI)">
        <ContextMenuJs items={ITEMS} onSelect={show}>
          <Row title="Draft release notes 2.4" />
        </ContextMenuJs>
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <ContextMenu items={ITEMS} onSelect={show}>
            <Row title="Fix flaky checkout test" />
          </ContextMenu>
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix (JS path)">
        <ThemeMatrix>
          <ContextMenuJs items={ITEMS} onSelect={show}>
            <Row title="Fix flaky checkout test" />
          </ContextMenuJs>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Native/ContextMenu', component: ContextMenuGallery } satisfies Meta<typeof ContextMenuGallery>;
export default meta;
export const Rows: StoryObj<typeof meta> = {};

import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';
import { NAV_DESTINATIONS } from '@generatorai/shared/ui-contract';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { BrandMark } from '../../primitives/BrandMark';
import { IconButton } from '../../primitives/IconButton';
import { SearchInput } from '../../primitives/SearchInput';
import { StatusDot } from '../../primitives/StatusDot';
import { Text } from '../../primitives/Text';
import { Drawer, DrawerLiveRow, DrawerNavItem, DrawerSection } from './Drawer';

const noop = (): void => undefined;

function Sample({ variant = 'modal', live = true }: { variant?: 'modal' | 'persistent'; live?: boolean }): React.ReactElement {
  const [selected, setSelected] = useState<string>('home');
  return (
    <View className="h-160 overflow-hidden rounded-card border border-line-soft bg-surface">
      <Drawer
        variant={variant}
        header={
          <>
            <BrandMark mark="app" size={26} />
            <View className="flex-1">
              <Text role="headline" numberOfLines={1}>GeneratorAI</Text>
              <Text role="caption" tone="fg-3">This computer</Text>
            </View>
            <IconButton icon="edit" label="New chat" variant="bordered" onPress={noop} />
          </>
        }
        search={<SearchInput value="" onChangeText={noop} placeholder="Search chats, runs, commands" size="compact" asButton onPress={noop} />}
        nav={NAV_DESTINATIONS.map((d) => (
          <DrawerNavItem key={d.id} destination={d.id} label={d.label} icon={d.icon} selected={selected === d.id} onPress={() => setSelected(d.id)} />
        ))}
        live={
          live ? (
            <>
              <DrawerSection label="Needs you" count={3} countTone="warn" testID="drawer-inbox" showAll={{ label: 'Show all (7)', onPress: noop }}>
                <DrawerLiveRow kind="needs-you" title="Nightly dependency audit" trailing="Approve" onPress={noop} />
                <DrawerLiveRow kind="needs-you" title="A very long chat title that keeps going past the width of the drawer" trailing="git push" onPress={noop} />
              </DrawerSection>
              <DrawerSection label="Running" count={1}>
                <DrawerLiveRow kind="running" title="Upgrade React Flow to v12" trailing="4:12" trailingMono onPress={noop} />
              </DrawerSection>
            </>
          ) : undefined
        }
        footer={
          <>
            <View className="flex-1 flex-row items-center gap-2">
              <StatusDot health="ok" size="sm" />
              <Text role="subhead" tone="fg-2">Connected</Text>
              <Text role="monoSm" tone="fg-3" numberOfLines={1}>local:3100</Text>
            </View>
            <IconButton icon="settings" label="Settings" onPress={noop} />
          </>
        }
      />
    </View>
  );
}

function DrawerGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Phone drawer (modal) with live sections">
        <Sample />
      </StorySection>
      <StorySection title="Tablet sidebar (persistent), nothing live (sections hidden)">
        <Sample variant="persistent" live={false} />
      </StorySection>
      <StorySection title="Font scale 1.6, right to left">
        <WithFontScale scale={1.6}>
          <Sample />
        </WithFontScale>
        <RightToLeft>
          <Sample />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Sample />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/Drawer', component: DrawerGallery } satisfies Meta<typeof DrawerGallery>;
export default meta;
export const Sidebar: StoryObj<typeof meta> = {};

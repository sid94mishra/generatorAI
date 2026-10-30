import React, { useState } from 'react';
import { Alert } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Button } from '../../primitives/Button';
import { Chip } from '../../primitives/Chip';
import { IconButton } from '../../primitives/IconButton';
import { Text } from '../../primitives/Text';
import { Menu } from './Menu';
import type { MenuEntry } from './Menu.types';
import { MenuJs } from './MenuJs';

const noop = (): void => undefined;

const CHAT_MENU: MenuEntry[] = [
  { id: 'rename', label: 'Rename', icon: 'edit' },
  { id: 'share', label: 'Share transcript', icon: 'copy' },
  { id: 'pane', label: 'Open workspace pane', icon: 'dock' },
  { type: 'separator' },
  { id: 'archive', label: 'Archive', icon: 'archive' },
  { id: 'delete', label: 'Delete', icon: 'trash', destructive: true },
];

function PlusMenu(): React.ReactElement {
  const [workflows, setWorkflows] = useState(true);
  const [picked, setPicked] = useState('—');
  const items: MenuEntry[] = [
    { id: 'files', label: 'Attach files', icon: 'attach' },
    { id: 'image', label: 'Photo library', icon: 'image' },
    { type: 'separator' },
    { id: 'workflows', label: 'Workflows', icon: 'workflows', checked: workflows },
    { id: 'mode', label: 'Mode', icon: 'mode-system', children: [{ id: 'auto', label: 'Auto', checked: true }, { id: 'plan', label: 'Plan', checked: false }] },
    { id: 'computer', label: 'Computer use', icon: 'computer', disabled: true, subtitle: 'Not allowed on this server' },
  ];
  return (
    <StoryRow>
      <Menu
        items={items}
        onSelect={(id) => (id === 'workflows' ? setWorkflows((v) => !v) : setPicked(id))}
        trigger={<IconButton icon="plus" label="Add" variant="bordered" onPress={noop} />}
      />
      <Text role="footnote" tone="fg-3">{`picked: ${picked}`}</Text>
    </StoryRow>
  );
}

function MenuGallery(): React.ReactElement {
  const show = (id: string): void => Alert.alert('Selected', id);
  return (
    <StoryPage>
      <StorySection title="Overflow (⋯ / ⋮): icons, separator, destructive last">
        <Menu items={CHAT_MENU} onSelect={show} trigger={<IconButton icon="more" label="More" onPress={noop} />} />
      </StorySection>
      <StorySection title="Composer +: checked item (MD-63), submenu, disabled with reason">
        <PlusMenu />
      </StorySection>
      <StorySection title="Dropdown chip and button triggers, with a title">
        <StoryRow>
          <Menu title="Sort chats" items={[{ id: 'recent', label: 'Recent', checked: true }, { id: 'name', label: 'Name', checked: false }]} onSelect={show} trigger={<Chip label="Recent" variant="dropdown" onPress={noop} />} />
          <Menu items={CHAT_MENU} onSelect={show} trigger={<Button label="Actions" trailingIcon="chevron-down" onPress={noop} />} />
        </StoryRow>
      </StorySection>
      <StorySection title="JS path (Jest, web, clients without Expo UI)">
        <MenuJs items={CHAT_MENU} onSelect={show} title="Fix flaky checkout test" trigger={<IconButton icon="more" label="More" onPress={noop} />} />
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <Menu items={CHAT_MENU} onSelect={show} trigger={<IconButton icon="more" label="More" onPress={noop} />} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix (JS panel)">
        <ThemeMatrix>
          <MenuJs items={CHAT_MENU} onSelect={show} trigger={<IconButton icon="more" label="More" onPress={noop} />} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Native/Menu', component: MenuGallery } satisfies Meta<typeof MenuGallery>;
export default meta;
export const AllVariants: StoryObj<typeof meta> = {};

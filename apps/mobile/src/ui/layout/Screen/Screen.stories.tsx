import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StorySection } from '../../storybook/StoryKit';
import { Button } from '../../primitives/Button';
import { Skeleton } from '../../primitives/Skeleton';
import { Text } from '../../primitives/Text';
import { ListRow } from '../ListRow';
import { ListSection } from '../ListSection';
import { NewAction } from '../NewAction';
import { TopAppBar } from '../TopAppBar';
import { Screen } from './Screen';
import type { ScreenState } from './Screen.types';

const noop = (): void => undefined;
const STATES: Array<{ label: string; state: ScreenState }> = [
  { label: 'Ready', state: { kind: 'ready' } },
  { label: 'Loading', state: { kind: 'loading', skeleton: <Skeleton preset="list" count={4} /> } },
  { label: 'Empty', state: { kind: 'empty', empty: <Text role="headline" align="center" className="p-8">No chats yet</Text> } },
  { label: 'Error', state: { kind: 'error', error: new Error('offline'), onRetry: noop, title: "Couldn't load chats" } },
];

// Storybook renders the JS bar as the header (the iOS native header only exists inside a route; M5 wires it).
function ScreenGallery(): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [refreshed, setRefreshed] = useState(0);
  return (
    <View className="flex-1">
      <View className="flex-row flex-wrap gap-2 bg-surface p-2">
        {STATES.map((s, i) => (
          <Button key={s.label} label={s.label} size="sm" variant={i === index ? 'tonal' : 'ghost'} onPress={() => setIndex(i)} />
        ))}
      </View>
      <Screen
        header={<TopAppBar role="top" title="Chats" onSidebarToggle={noop} actions={[{ id: 'search', icon: 'search', label: 'Search', onPress: noop }]} />}
        background="grouped"
        state={STATES[index]!.state}
        onRefresh={async () => setRefreshed((n) => n + 1)}
        bottomAccessory={<NewAction label="New chat" icon="plus" onPress={noop} />}
      >
        <StorySection title={`Pull to refresh (${refreshed}); the last row clears the NewAction`}>
          {Array.from({ length: 4 }, (_, s) => (
            <ListSection key={s} title={`Section ${s + 1}`}>
              {Array.from({ length: 4 }, (__, r) => (
                <ListRow key={r} kind="navigation" icon="chats" title={`Row ${s * 4 + r + 1}`} onPress={noop} />
              ))}
            </ListSection>
          ))}
        </StorySection>
      </Screen>
    </View>
  );
}

const meta = { title: 'UI/Layout/Screen', component: ScreenGallery } satisfies Meta<typeof ScreenGallery>;
export default meta;
export const States: StoryObj<typeof meta> = {};

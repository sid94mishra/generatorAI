import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Text } from '../../primitives/Text';
import { EntityRow } from '../EntityRow';
import { SwipeRow } from './SwipeRow';

const noop = (): void => undefined;

function Rows(): React.ReactElement {
  const [log, setLog] = useState('—');
  const trailing = (title: string) => [
    { id: 'more', label: 'More', icon: 'more' as const, tone: 'neutral' as const, onPress: () => setLog(`More: ${title}`) },
    { id: 'archive', label: 'Archive', icon: 'archive' as const, tone: 'strong' as const, onPress: () => setLog(`Archived: ${title}`) },
  ];
  return (
    <>
      <View>
        {['Fix flaky checkout test', 'React Flow to v12', 'Draft release notes 2.4'].map((title) => (
          <SwipeRow key={title} trailing={trailing(title)}>
            <EntityRow title={title} leading={{ status: 'needs_you' }} meta={['payments-service']} onPress={noop} />
          </SwipeRow>
        ))}
        <SwipeRow leading={[{ id: 'pin', label: 'Pin', icon: 'pin', tone: 'neutral', onPress: () => setLog('Pinned') }]} trailing={trailing('No full swipe')} fullSwipe={false}>
          <EntityRow title="Leading Pin, full swipe off" leading={{ status: 'succeeded' }} onPress={noop} />
        </SwipeRow>
      </View>
      <Text role="footnote" tone="fg-3">{`last: ${log} — swipe left; a full swipe archives (threshold haptic)`}</Text>
    </>
  );
}

function SwipeRowGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Chat rows (iOS tiles / Android pills; MD-52)">
        <Rows />
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <SwipeRow trailing={[{ id: 'archive', label: 'Archive', icon: 'archive', tone: 'strong', onPress: noop }]}>
            <EntityRow title="Fix flaky checkout test" leading={{ status: 'needs_you' }} onPress={noop} />
          </SwipeRow>
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <SwipeRow trailing={[{ id: 'archive', label: 'Archive', icon: 'archive', tone: 'strong', onPress: noop }]}>
            <EntityRow title="Fix flaky checkout test" leading={{ status: 'needs_you' }} onPress={noop} />
          </SwipeRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/SwipeRow', component: SwipeRowGallery } satisfies Meta<typeof SwipeRowGallery>;
export default meta;
export const ChatRows: StoryObj<typeof meta> = {};

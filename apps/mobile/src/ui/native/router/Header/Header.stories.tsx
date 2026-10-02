import React from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix } from '../../../storybook/StoryKit';
import { BreadcrumbTitle } from '../../../layout/Breadcrumb';
import { TopAppBar } from '../../../layout/TopAppBar';
import { Text } from '../../../primitives/Text';

const noop = (): void => undefined;
const CRUMBS = [{ label: 'Chats', onPress: noop }, { label: 'payments-service', onPress: noop }];

// The iOS header is the native stack header: it only renders inside a route (M5 wires it). Storybook shows its custom
// title view and the Android / web bar that Header renders on those platforms.
function HeaderGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="iOS custom title view (breadcrumb over the detail title, centred; one element, crumbs as actions)">
        <View className="items-center rounded-card bg-raised py-2">
          <BreadcrumbTitle breadcrumb={CRUMBS} title="Fix flaky checkout test" />
        </View>
        <Text role="footnote" tone="fg-3">
          Large title, toolbar glass buttons, the ⋯ overflow and the modal prominent confirm are native — check them on a route.
        </Text>
      </StorySection>
      <StorySection title="Android / web: the JS M3 top app bar (all roles: see UI/Layout/TopAppBar)">
        <TopAppBar role="workspace" title="Fix flaky checkout test" breadcrumb={CRUMBS} onBack={noop} paneToggle={{ open: false, count: 2, attention: false, onPress: noop }} />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <BreadcrumbTitle breadcrumb={CRUMBS} title="Fix flaky checkout test" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Native/Header', component: HeaderGallery } satisfies Meta<typeof HeaderGallery>;
export default meta;
export const TitleViewAndBar: StoryObj<typeof meta> = {};

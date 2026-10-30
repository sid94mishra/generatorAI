import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection } from '../../storybook/StoryKit';
import { Button } from '../../primitives/Button';
import { Text } from '../../primitives/Text';
import { SidePanel } from '../SidePanel';
import { AdaptiveLayout } from './AdaptiveLayout';

/** Rotate the device or resize the window (iPad Split View, Android free-form): the panels change presentation only. */
function Live(): React.ReactElement {
  const [drawer, setDrawer] = useState(false);
  const [pane, setPane] = useState(true);
  const [hidden, setHidden] = useState(false);
  return (
    <View className="h-160 overflow-hidden rounded-card border border-line-soft">
      <AdaptiveLayout
        startHidden={hidden}
        startOverlayOpen={drawer}
        endOpen={pane}
        start={({ presentation }) => (
          <SidePanel side="start" open={drawer} onOpenChange={setDrawer} presentation={presentation} accessibilityLabel="Sidebar">
            <View className="flex-1 p-4">
              <Text role="headline">{`Sidebar · ${presentation}`}</Text>
            </View>
          </SidePanel>
        )}
        end={(slot) => (
          <SidePanel side="end" open={pane} onOpenChange={setPane} presentation={slot.presentation} width={slot.width} accessibilityLabel="Workspace pane">
            <View className="flex-1 p-4">
              <Text role="headline">{`Pane · ${slot.presentation}`}</Text>
            </View>
          </SidePanel>
        )}
      >
        <View className="flex-1 items-center justify-center gap-3 p-4">
          <Button label="Toggle drawer" onPress={() => setDrawer((v) => !v)} />
          <Button label={hidden ? 'Show sidebar' : 'Hide sidebar'} onPress={() => setHidden((v) => !v)} />
          <Button label={pane ? 'Close pane' : 'Open pane'} onPress={() => setPane((v) => !v)} />
        </View>
      </AdaptiveLayout>
    </View>
  );
}

function AdaptiveLayoutGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Live: compact < 600 (drawer + overlay pane) · medium (sidebar + overlay pane) · expanded ≥ 840 (sidebar + docked pane)">
        <Live />
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/AdaptiveLayout', component: AdaptiveLayoutGallery } satisfies Meta<typeof AdaptiveLayoutGallery>;
export default meta;
export const SizeClasses: StoryObj<typeof meta> = {};

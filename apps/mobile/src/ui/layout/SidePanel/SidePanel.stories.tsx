import React, { useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Button } from '../../primitives/Button';
import { Text } from '../../primitives/Text';
import { SidePanel } from './SidePanel';
import type { SidePanelPresentation, SidePanelSide } from './SidePanel.types';

function Frame({ side, presentation, edge = false }: { side: SidePanelSide; presentation: SidePanelPresentation; edge?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(presentation !== 'overlay');
  return (
    <View className="h-96 flex-row overflow-hidden rounded-card border border-line-soft bg-ground">
      {side === 'start' ? (
        <SidePanel side="start" open={open} onOpenChange={setOpen} presentation={presentation} edgeOpenEnabled={edge} accessibilityLabel="Sidebar" width={presentation === 'persistent' ? 160 : 220}>
          <View className="flex-1 gap-2 p-4">
            <Text role="headline">Sidebar</Text>
            <Text role="footnote" tone="fg-2">Drag toward the start edge, tap the scrim or press Back to close.</Text>
          </View>
        </SidePanel>
      ) : null}
      <View className="flex-1 items-center justify-center gap-3 p-4">
        <Text role="subhead" tone="fg-2">{`${side} · ${presentation}`}</Text>
        <Button label={open ? 'Close' : 'Open'} onPress={() => setOpen((v) => !v)} />
      </View>
      {side === 'end' ? (
        <SidePanel side="end" open={open} onOpenChange={setOpen} presentation={presentation} accessibilityLabel="Workspace pane" width={presentation === 'persistent' ? 180 : undefined}>
          <View className="flex-1 gap-2 p-4">
            <Text role="headline">Workspace</Text>
            <Text role="footnote" tone="fg-2">Pane content stays mounted across presentations.</Text>
          </View>
        </SidePanel>
      ) : null}
    </View>
  );
}

function SidePanelGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Start · overlay (phone drawer; iOS edge strip on)">
        <Frame side="start" presentation="overlay" edge />
      </StorySection>
      <StorySection title="Start · persistent (iPad inset card / Android tablet edge-attached)">
        <Frame side="start" presentation="persistent" />
      </StorySection>
      <StorySection title="End · overlay (phone pane)">
        <Frame side="end" presentation="overlay" />
      </StorySection>
      <StorySection title="End · persistent (docked pane ≥ 840)">
        <Frame side="end" presentation="persistent" />
      </StorySection>
      <StorySection title="End · fullscreen (pane full screen mode)">
        <Frame side="end" presentation="fullscreen" />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Frame side="start" presentation="persistent" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/SidePanel', component: SidePanelGallery } satisfies Meta<typeof SidePanelGallery>;
export default meta;
export const Presentations: StoryObj<typeof meta> = {};

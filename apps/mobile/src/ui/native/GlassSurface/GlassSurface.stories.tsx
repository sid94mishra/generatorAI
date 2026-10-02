import React from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';
import { GlassContainer, GlassView } from 'expo-glass-effect';

import { GlassBackdrop, StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Icon } from '../../primitives/Icon';
import { Text } from '../../primitives/Text';
import { GlassGroup, GlassSurface } from './GlassSurface';

function Samples(): React.ReactElement {
  return (
    <View className="gap-3">
      <GlassSurface radiusStep="new" interactive className="min-h-new flex-row items-center gap-2 self-start pe-5 ps-4">
        <Icon concept="plus" size={20} tone="fg" />
        <Text role="body" weight={600}>
          New chat
        </Text>
      </GlassSurface>
      <GlassSurface radiusStep="toast" className="min-h-toast flex-row items-center px-4">
        <Text role="subhead">Chat archived</Text>
      </GlassSurface>
      <GlassSurface radiusStep="composer" className="min-h-14 justify-center px-4">
        <Text role="transcript" tone="fg-3">
          Reply to Bug Fixer…
        </Text>
      </GlassSurface>
      <GlassGroup>
        <GlassSurface radiusStep="full" interactive className="size-icon-button items-center justify-center">
          <Icon concept="chevron-up" size={20} tone="fg" />
        </GlassSurface>
        <GlassSurface radiusStep="full" interactive className="size-icon-button items-center justify-center">
          <Icon concept="chevron-down" size={20} tone="fg" />
        </GlassSurface>
      </GlassGroup>
    </View>
  );
}

// Raw expo-glass-effect views (no withUniwind, no Pressable): the reference GlassSurface must match on iOS 26+.
const RAW_CAPSULE = { width: 200, height: 56, borderRadius: 28 };
const RAW_ROW = { flexDirection: 'row' as const, gap: 8 };
const RAW_CIRCLE = { width: 56, height: 56, borderRadius: 28 };

function RawGlass(): React.ReactElement {
  return (
    <View className="gap-4">
      <GlassView glassEffectStyle="regular" style={RAW_CAPSULE} />
      <GlassContainer spacing={8} style={RAW_ROW}>
        <GlassView glassEffectStyle="regular" isInteractive style={RAW_CIRCLE} />
        <GlassView glassEffectStyle="regular" isInteractive style={RAW_CIRCLE} />
      </GlassContainer>
    </View>
  );
}

function GlassSurfaceGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Reference: raw GlassView (200 × 56, r28) and two raw GlassViews in a GlassContainer">
        <GlassBackdrop>
          <RawGlass />
        </GlassBackdrop>
      </StorySection>
      <StorySection title="Steps new / toast / composer / full in a merge group (iOS glass; fallback elsewhere and under Reduce Transparency)">
        <GlassBackdrop>
          <Samples />
        </GlassBackdrop>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <GlassBackdrop>
            <Samples />
          </GlassBackdrop>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Native/GlassSurface', component: GlassSurfaceGallery } satisfies Meta<typeof GlassSurfaceGallery>;
export default meta;
export const Steps: StoryObj<typeof meta> = {};

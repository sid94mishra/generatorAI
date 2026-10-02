import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Input } from '../Input';
import { Pressable } from '../Pressable';
import { Text } from '../Text';
import { Popover } from './Popover';

const SUGGESTIONS = [
  { id: 'review', label: '/review', detail: 'Review the current diff' },
  { id: 'test', label: '/test', detail: 'Run the test suite' },
  { id: 'plan', label: '/plan', detail: 'Draft a plan first' },
];

function Rows({ onPick }: { onPick: (id: string) => void }): React.ReactElement {
  return (
    <>
      {SUGGESTIONS.map((s) => (
        <Pressable key={s.id} frame="none" onPress={() => onPick(s.id)} accessibilityRole="menuitem" accessibilityLabel={`${s.label}, ${s.detail}`} className="min-h-item flex-row items-center gap-3 px-4">
          <Icon concept="skills" size={18} tone="fg-2" />
          <Text role="mono" weight={500}>
            {s.label}
          </Text>
          <Text role="footnote" tone="fg-3" numberOfLines={1} className="flex-1">
            {s.detail}
          </Text>
        </Pressable>
      ))}
    </>
  );
}

function ComposerDemo(): React.ReactElement {
  const [text, setText] = useState('/');
  const open = text.startsWith('/') && !text.includes(' ');
  return (
    <View className="relative mt-56">
      <Popover open={open} onOpenChange={(v) => !v && setText('')} anchor="composer" accessibilityLabel="Suggestions" resultCount={SUGGESTIONS.length}>
        <Rows onPick={(id) => setText(`/${id} `)} />
      </Popover>
      <Input label="Message" presentation="standalone" value={text} onChangeText={setText} />
    </View>
  );
}

function AnchoredDemo(): React.ReactElement {
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  return (
    <View className="relative min-h-72 justify-start">
      <View ref={anchor} collapsable={false} className="self-start">
        <Button label="Anchor (below)" onPress={() => setOpen((v) => !v)} />
      </View>
      <Popover open={open} onOpenChange={setOpen} anchor={anchor} placement="bottom" accessibilityLabel="Mentions">
        <Rows onPick={() => setOpen(false)} />
      </Popover>
    </View>
  );
}

function PopoverGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Above the composer (type “/”; typing continues)">
        <ComposerDemo />
      </StorySection>
      <StorySection title="Anchored to a view, below">
        <AnchoredDemo />
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <View className="relative min-h-60">
            <Popover open onOpenChange={() => undefined} anchor="composer" placement="bottom" accessibilityLabel="Suggestions">
              <Rows onPick={() => undefined} />
            </Popover>
          </View>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Popover', component: PopoverGallery } satisfies Meta<typeof PopoverGallery>;
export default meta;
export const Placements: StoryObj<typeof meta> = {};

import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { IconButton } from './IconButton';
import type { IconButtonVariant } from './IconButton.types';

const VARIANTS: IconButtonVariant[] = ['plain', 'glass', 'bordered', 'filled', 'tonal'];
const noop = (): void => undefined;

function Toggle(): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <IconButton
      icon="dock"
      label={open ? 'Hide workspace pane, 2 changes' : 'Open workspace pane, 2 changes'}
      selected={open}
      badge={{ count: 2 }}
      onPress={() => setOpen((v) => !v)}
    />
  );
}

function IconButtonGallery(): React.ReactElement {
  return (
    <StoryPage>
      {(['md', 'sm'] as const).map((size) => (
        <StorySection key={size} title={`Variants · ${size}`}>
          <StoryRow>
            {VARIANTS.map((variant) => (
              <IconButton key={variant} icon={variant === 'filled' ? 'send' : 'search'} label={variant} variant={variant} size={size} onPress={noop} />
            ))}
          </StoryRow>
        </StorySection>
      ))}
      <StorySection title="Selected toggle with count, dot, run bubble, filled glyph, disabled">
        <StoryRow>
          <Toggle />
          <IconButton icon="dock" label="Workspace pane, needs you" badge={{ dot: 'warn' }} onPress={noop} />
          <IconButton icon="tasks" label="Tasks, 4 running" badge={{ count: 4, tone: 'run' }} onPress={noop} />
          <IconButton icon="stop" label="Stop" variant="filled" filled onPress={noop} />
          <IconButton icon="mic" label="Dictate" disabled onPress={noop} />
        </StoryRow>
      </StorySection>
      <StorySection title="Right to left (chevrons mirror)">
        <RightToLeft>
          <StoryRow>
            <IconButton icon="chevron-left" label="Back" onPress={noop} />
            <IconButton icon="more" label="More" onPress={noop} />
          </StoryRow>
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StoryRow>
            <IconButton icon="sidebar" label="Show sidebar" onPress={noop} />
            <IconButton icon="send" label="Send" variant="filled" onPress={noop} />
            <IconButton icon="attach" label="Attach" variant="bordered" size="sm" onPress={noop} />
          </StoryRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/IconButton', component: IconButtonGallery } satisfies Meta<typeof IconButtonGallery>;
export default meta;
export const AllVariants: StoryObj<typeof meta> = {};

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StoryRow, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Button } from './Button';
import type { ButtonSize, ButtonVariant } from './Button.types';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'tonal', 'ghost', 'destructive'];
const SIZES: ButtonSize[] = ['sm', 'md', 'lg'];
const noop = (): void => undefined;

function ButtonGallery(): React.ReactElement {
  return (
    <StoryPage>
      {SIZES.map((size) => (
        <StorySection key={size} title={`Variants · ${size}`}>
          <StoryRow>
            {VARIANTS.map((variant) => (
              <Button key={variant} label={variant === 'destructive' ? 'Delete' : variant} variant={variant} size={size} icon={variant === 'destructive' ? 'trash' : undefined} onPress={noop} />
            ))}
          </StoryRow>
        </StorySection>
      ))}
      <StorySection title="States">
        <StoryRow>
          <Button label="Disabled" disabled disabledReason="Nothing to save" onPress={noop} />
          <Button label="Working" variant="primary" loading onPress={noop} />
          <Button label="Open" trailingIcon="external-link" onPress={noop} />
          <Button label="Sonnet 5" variant="ghost" trailingIcon="chevron-down" onPress={noop} />
        </StoryRow>
      </StorySection>
      <StorySection title="Full width (lg CTA) and long label">
        <Button label="Create pull request" variant="primary" size="lg" fullWidth onPress={noop} />
        <Button label={LONG_TEXT} onPress={noop} />
      </StorySection>
      <StorySection title="Font scale 2.0">
        <WithFontScale scale={2}>
          <StoryRow>
            <Button label="Allow once" variant="primary" onPress={noop} />
            <Button label="Deny" onPress={noop} />
          </StoryRow>
        </WithFontScale>
      </StorySection>
      <StorySection title="Right to left">
        <RightToLeft>
          <StoryRow>
            <Button label="Run" icon="play" variant="primary" onPress={noop} />
            <Button label="Next" trailingIcon="chevron-right" onPress={noop} />
          </StoryRow>
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StoryRow>
            <Button label="Allow once" variant="primary" onPress={noop} />
            <Button label="Deny" onPress={noop} />
            <Button label="Delete" variant="destructive" icon="trash" onPress={noop} />
          </StoryRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/Button', component: ButtonGallery } satisfies Meta<typeof ButtonGallery>;
export default meta;
export const AllVariants: StoryObj<typeof meta> = {};

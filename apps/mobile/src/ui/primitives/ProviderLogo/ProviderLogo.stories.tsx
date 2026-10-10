import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';
import { HARNESS_PROVIDER_IDS, harnessProviderLabel } from '@generatorai/shared';

import { StoryPage, StoryRow, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { ProviderLogo } from './ProviderLogo';
import type { ProviderLogoSize } from './ProviderLogo.types';

const PROVIDERS = [...HARNESS_PROVIDER_IDS, 'faux', 'unknown-provider'];
const SIZES: ProviderLogoSize[] = [16, 20, 24, 28];

function ProviderLogoGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Every provider, colour">
        <StoryRow>
          {PROVIDERS.map((p) => (
            <ProviderLogo key={p} provider={p} size={24} label={harnessProviderLabel(p)} />
          ))}
        </StoryRow>
      </StorySection>
      <StorySection title="Every provider, mono">
        <StoryRow>
          {PROVIDERS.map((p) => (
            <ProviderLogo key={p} provider={p} size={24} variant="mono" label={`${harnessProviderLabel(p)} mono`} />
          ))}
        </StoryRow>
      </StorySection>
      <StorySection title="Sizes">
        <StoryRow>
          {SIZES.map((size) => (
            <ProviderLogo key={size} provider="claude-agent" size={size} />
          ))}
        </StoryRow>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <StoryRow>
            {HARNESS_PROVIDER_IDS.map((p) => (
              <ProviderLogo key={p} provider={p} size={20} />
            ))}
          </StoryRow>
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/ProviderLogo', component: ProviderLogoGallery } satisfies Meta<typeof ProviderLogoGallery>;
export default meta;
export const Gallery: StoryObj<typeof meta> = {};

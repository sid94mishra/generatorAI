import React from 'react';
import { screen } from '@testing-library/react-native';
import { PROVIDER_LOGOS } from '@generatorai/design-tokens';
import { ProviderLogo } from './ProviderLogo';
import { renderThemed } from '../../__tests__/themed';

describe('ProviderLogo (D-132)', () => {
  it('is an image with the brand name when labelled, decorative otherwise', async () => {
    await renderThemed(
      <>
        <ProviderLogo provider="codex" label />
        <ProviderLogo provider="copilot" testID="copilot" />
      </>,
    );
    expect(screen.getByRole('image', { name: PROVIDER_LOGOS.codex.title })).toBeTruthy();
    expect(screen.getByTestId('copilot', { includeHiddenElements: true }).props.accessible).toBe(false);
  });

  it('draws an unknown provider with the neutral mark instead of failing', async () => {
    await renderThemed(<ProviderLogo provider="not-a-provider" label="Unknown" />);
    expect(screen.getByRole('image', { name: 'Unknown' })).toBeTruthy();
  });
});

import React from 'react';
import { screen } from '@testing-library/react-native';
import { BrandMark, vendorFor } from './BrandMark';
import { renderThemed } from '../../__tests__/themed';

describe('BrandMark (MP-52)', () => {
  it('maps harness providers to the vendor that serves them', () => {
    expect(vendorFor('claude-agent')).toBe('claude');
    expect(vendorFor('codex')).toBe('openai');
    expect(vendorFor('copilot')).toBe('github');
    expect(vendorFor('opencode')).toBe('generic');
  });

  it('is an image when labelled and decorative otherwise', async () => {
    await renderThemed(
      <>
        <BrandMark mark="app" size={36} label="GeneratorAI" />
        <BrandMark mark="github" testID="gh" />
      </>,
    );
    expect(screen.getByRole('image', { name: 'GeneratorAI' })).toBeTruthy();
    expect(screen.getByTestId('gh', { includeHiddenElements: true }).props.accessible).toBe(false);
  });
});

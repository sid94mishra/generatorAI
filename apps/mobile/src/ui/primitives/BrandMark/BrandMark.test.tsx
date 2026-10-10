import React from 'react';
import { screen } from '@testing-library/react-native';
import { BrandMark } from './BrandMark';
import { renderThemed } from '../../__tests__/themed';

describe('BrandMark (MP-52)', () => {
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

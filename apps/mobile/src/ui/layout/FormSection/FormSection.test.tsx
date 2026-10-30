import React from 'react';
import { screen } from '@testing-library/react-native';
import { Text } from '../../primitives/Text';
import { FormSection } from './FormSection';
import { renderThemed } from '../../__tests__/themed';

describe('FormSection (ML-22)', () => {
  it('titles its fields with a header and hint', async () => {
    await renderThemed(
      <FormSection title="Server" hint="Shown in the tool list.">
        <Text>Field A</Text>
        <Text>Field B</Text>
      </FormSection>,
    );
    expect(screen.getByRole('header', { name: 'Server' })).toBeTruthy();
    expect(screen.getByText('Shown in the tool list.')).toBeTruthy();
    expect(screen.getByText('Field B')).toBeTruthy();
  });
});

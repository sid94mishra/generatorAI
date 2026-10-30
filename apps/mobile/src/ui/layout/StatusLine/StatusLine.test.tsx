import React from 'react';
import { screen } from '@testing-library/react-native';
import { StatusLine } from './StatusLine';
import { renderThemed } from '../../__tests__/themed';

describe('StatusLine (ML-04)', () => {
  it('shows the status word and meta in a polite live region', async () => {
    await renderThemed(<StatusLine status={{ state: 'needs_you' }} meta={['v7']} testID="sl" />);
    expect(screen.getByTestId('sl').props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByLabelText('Needs you')).toBeTruthy();
    expect(screen.getByText('· v7')).toBeTruthy();
  });
});

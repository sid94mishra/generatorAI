import React from 'react';
import { screen } from '@testing-library/react-native';
import { StatusBadge } from '../../primitives/StatusBadge';
import { FactStrip } from './FactStrip';
import { renderThemed } from '../../__tests__/themed';

describe('FactStrip (ML-24)', () => {
  it('reads text facts as "label, value" and renders element values', async () => {
    await renderThemed(<FactStrip facts={[{ label: 'Status', value: <StatusBadge state="failed" /> }, { label: 'Exit code', value: '1', mono: true }]} />);
    expect(screen.getByLabelText('Exit code, 1')).toBeTruthy();
    expect(screen.getByLabelText('Failed')).toBeTruthy();
  });
});

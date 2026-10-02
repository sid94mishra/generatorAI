import React from 'react';
import { screen } from '@testing-library/react-native';
import { Badge, badgeFrame } from './Badge';
import { renderThemed } from '../../__tests__/themed';

describe('Badge (MP-06)', () => {
  it('renders the label as plain text with a mono suffix', async () => {
    await renderThemed(<Badge label="Workflow" suffix="v7" testID="b" />);
    expect(screen.getByText('Workflow', { exact: false })).toBeTruthy();
    expect(screen.getByTestId('b').props.className).toContain('bg-selected');
  });
  it('uses the MD-64 heights per size', () => {
    expect(badgeFrame('md')).toContain('min-h-badge ');
    expect(badgeFrame('sm')).toContain('min-h-badge-sm');
  });
});

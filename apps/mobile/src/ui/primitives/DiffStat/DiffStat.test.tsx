import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { DiffStat, diffStatLabel } from './DiffStat';

describe('DiffStat (MP-51)', () => {
  it('speaks the counts and never invents 0 for unknown', () => {
    expect(diffStatLabel({ additions: 14, deletions: 6, files: 2 })).toBe('14 lines added, 6 removed, 2 files');
    expect(diffStatLabel({})).toBe('Changes unknown');
  });
  it('renders the minus sign and the unknown dash', async () => {
    await render(<><DiffStat additions={1} deletions={2} /><DiffStat testID="u" /></>);
    expect(screen.getByText('\u22122')).toBeTruthy();
    expect(screen.getByTestId('u').props.children).toContain('—');
  });
});

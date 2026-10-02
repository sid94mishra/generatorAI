import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ProgressBar, clampProgress } from './ProgressBar';

describe('ProgressBar (MP-14)', () => {
  it('is a progressbar with its value', async () => {
    await render(<ProgressBar value={0.38} label="Cloning" />);
    const bar = screen.getByRole('progressbar', { name: 'Cloning' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 38 });
  });
  it('is busy and valueless when indeterminate', async () => {
    await render(<ProgressBar accessibilityLabel="Uploading" />);
    const bar = screen.getByRole('progressbar', { name: 'Uploading' });
    expect(bar.props.accessibilityState).toMatchObject({ busy: true });
    expect(bar.props.accessibilityValue).toBeUndefined();
  });
  it('clamps', () => {
    expect(clampProgress(1.4)).toBe(1);
    expect(clampProgress(-1)).toBe(0);
  });
});

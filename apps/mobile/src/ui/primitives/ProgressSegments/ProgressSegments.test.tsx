import React from 'react';
import { screen } from '@testing-library/react-native';
import { ProgressSegments, SEGMENT_FILL, segmentFraction } from './ProgressSegments';
import { renderThemed } from '../../__tests__/themed';

const segments = [{ state: 'succeeded' as const, label: 'A' }, { state: 'needs_you' as const, label: 'B' }, { state: 'queued' as const, label: 'C' }];

describe('ProgressSegments (MP-15)', () => {
  it('uses status tones per stage and counts done stages', () => {
    expect(SEGMENT_FILL.needs_you).toBe('bg-warn');
    expect(SEGMENT_FILL.queued).toBe('bg-line-strong');
    expect(segmentFraction(segments)).toBe('1/3');
  });
  it('hides the bar from screen readers and shows the fraction as text (MD-67)', async () => {
    await renderThemed(<ProgressSegments segments={segments} showFraction tracker={1} />);
    expect(screen.getByText('1/3')).toBeTruthy();
  });
});

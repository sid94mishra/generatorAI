import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { WithFontScale } from '../../storybook/StoryKit';
import { SegmentedControl } from './SegmentedControl';
import { chooseSegmentedPresentation, estimateSegmentsWidth, needsDrawnSegments } from './segmentedModel';
import { renderThemed } from '../../__tests__/themed';

const base = { fontScale: 1, available: 360, intrinsic: 200, drawn: false, platform: 'ios' as const };

describe('SegmentedControl (MP-23)', () => {
  it('chooses native, drawn or Select (MD-47)', () => {
    expect(chooseSegmentedPresentation({ ...base, count: 2 })).toBe('native');
    expect(chooseSegmentedPresentation({ ...base, count: 3, drawn: true })).toBe('js');
    expect(chooseSegmentedPresentation({ ...base, count: 5 })).toBe('select');
    expect(chooseSegmentedPresentation({ ...base, count: 2, fontScale: 1.3, platform: 'android' })).toBe('select');
    expect(chooseSegmentedPresentation({ ...base, count: 2, fontScale: 1.3 })).toBe('native');
    expect(chooseSegmentedPresentation({ ...base, count: 2, intrinsic: 400 })).toBe('select');
    expect(chooseSegmentedPresentation({ ...base, count: 2, available: 0, intrinsic: 400 })).toBe('native');
    expect(needsDrawnSegments([{ value: 'a', label: 'A', count: 1 }])).toBe(true);
    expect(estimateSegmentsWidth([{ value: 'a', label: 'Auto' }], 2)).toBeGreaterThan(estimateSegmentsWidth([{ value: 'a', label: 'Auto' }], 1));
  });

  it('draws a radiogroup of radios with counts and selects', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    // The Jest window reports font scale 2; the app's default is 1.
    await renderThemed(
      <WithFontScale scale={1}>
        <SegmentedControl
          segments={[{ value: 'all', label: 'All', count: 4 }, { value: 'archived', label: 'Archived', count: 1 }, { value: 'x', label: 'Locked', locked: true }]}
          value="all"
          onValueChange={onValueChange}
          accessibilityLabel="Filter chats"
          testID="chats-filter"
        />
      </WithFontScale>,
    );
    expect(screen.getByLabelText('Filter chats').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: 'All, 4' }).props.accessibilityState).toMatchObject({ checked: true });
    await user.press(screen.getByTestId('chats-filter-archived'));
    expect(onValueChange).toHaveBeenCalledWith('archived');
    await user.press(screen.getByRole('radio', { name: 'Locked' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it('becomes a Select past four segments and at large text', async () => {
    const segments = ['A', 'B', 'C', 'D', 'E'].map((l) => ({ value: l, label: l }));
    await renderThemed(
      <WithFontScale scale={1}>
        <SegmentedControl segments={segments} value="C" onValueChange={jest.fn()} accessibilityLabel="Effort" />
      </WithFontScale>,
    );
    expect(screen.getByRole('button', { name: 'Effort, C' })).toBeTruthy();
    await renderThemed(
      <WithFontScale scale={2}>
        <SegmentedControl segments={segments.slice(0, 2)} value="A" onValueChange={jest.fn()} accessibilityLabel="Mode" />
      </WithFontScale>,
    );
    expect(screen.getByRole('button', { name: 'Mode, A' })).toBeTruthy();
  });
});

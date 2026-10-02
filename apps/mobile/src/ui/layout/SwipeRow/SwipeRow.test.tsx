import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { EntityRow } from '../EntityRow';
import { SwipeRow } from './SwipeRow';
import { fullSwipeAction, fullSwipeDistance, revealWidth, swipeableLeading } from './swipeRowModel';
import { renderThemed } from '../../__tests__/themed';

const more = { id: 'more', label: 'More', icon: 'more' as const, tone: 'neutral' as const, onPress: jest.fn() };
const archive = { id: 'archive', label: 'Archive', icon: 'archive' as const, tone: 'strong' as const, onPress: jest.fn() };

describe('SwipeRow (ML-15)', () => {
  it('computes widths, the arming distance and the full-swipe action (MD-52)', () => {
    expect(revealWidth(2, 74)).toBe(148);
    expect(fullSwipeDistance(400, 148)).toBe(240);
    expect(fullSwipeDistance(300, 148)).toBe(208);
    expect(fullSwipeAction({ trailing: [more, archive] }, 'trailing')).toBe(archive);
    expect(fullSwipeAction({ trailing: [more, archive], fullSwipe: false }, 'trailing')).toBeUndefined();
    expect(fullSwipeAction({ leading: [more], trailing: [archive] }, 'leading')).toBeUndefined();
  });

  it('draws leading actions on iOS only; Android keeps them as accessibility actions (MD-52)', () => {
    expect(swipeableLeading([more], 'ios')).toEqual([more]);
    expect(swipeableLeading([more], 'android')).toEqual([]);
    expect(swipeableLeading(undefined, 'ios')).toEqual([]);
  });

  it('exposes every swipe action as an accessibility action on the row (MD-28)', async () => {
    await renderThemed(
      <SwipeRow trailing={[more, archive]}>
        <EntityRow title="Fix flaky test" leading={{ status: 'needs_you' }} onPress={jest.fn()} />
      </SwipeRow>,
    );
    const row = screen.getByRole('button', { name: /Fix flaky test/ });
    expect(row.props.accessibilityActions.map((a: { label: string }) => a.label)).toEqual(['More', 'Archive']);
    fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'archive' } });
    expect(archive.onPress).toHaveBeenCalled();
  });
});

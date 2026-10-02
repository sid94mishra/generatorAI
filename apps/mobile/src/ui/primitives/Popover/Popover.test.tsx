import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { Text } from '../Text';
import { Popover } from './Popover';
import { popoverAnnouncement, popoverMaxHeight, popoverOffsets } from './popoverModel';
import { renderThemed } from '../../__tests__/themed';

describe('Popover (MP-49)', () => {
  it('places against the anchor, caps its height and announces the count', () => {
    expect(popoverOffsets({ y: 100, height: 44 }, 400, 'bottom')).toEqual({ top: 152 });
    expect(popoverOffsets({ y: 100, height: 44 }, 400, 'top')).toEqual({ bottom: 308 });
    expect(popoverOffsets(null, 0, 'top')).toEqual({ bottom: 8 });
    expect(popoverMaxHeight(800, -300)).toBe(250);
    expect(popoverAnnouncement('Suggestions', 1)).toBe('Suggestions, 1 result');
  });

  it('renders only when open, labelled and non-modal (typing continues)', async () => {
    const onOpenChange = jest.fn();
    const user = userEvent.setup();
    const { rerender } = await renderThemed(
      <Popover open={false} onOpenChange={onOpenChange} anchor="composer" accessibilityLabel="Suggestions">
        <Text>/review</Text>
      </Popover>,
    );
    expect(screen.queryByText('/review')).toBeNull();
    await rerender(
      <Popover open onOpenChange={onOpenChange} anchor="composer" accessibilityLabel="Suggestions" resultCount={3} testID="pop">
        <Text>/review</Text>
      </Popover>,
    );
    expect(screen.getByTestId('pop').props.accessibilityLabel).toBe('Suggestions, 3 results');
    expect(screen.getByTestId('pop').props.accessibilityViewIsModal).toBe(false);
    await user.press(screen.getByText('/review'));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { Text } from 'react-native';
import { screen, userEvent } from '@testing-library/react-native';
import { Collapsible } from './Collapsible';
import { renderThemed } from '../../__tests__/themed';

describe('Collapsible (MP-47)', () => {
  it('expands and reports the expanded state', async () => {
    const onExpandedChange = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <Collapsible header={<Text>Steps</Text>} accessibilityLabel="Steps" onExpandedChange={onExpandedChange}>
        <Text>Body</Text>
      </Collapsible>,
    );
    const header = screen.getByRole('button', { name: 'Steps' });
    expect(header.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByText('Body')).toBeNull();
    await user.press(header);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(screen.getByText('Body')).toBeTruthy();
  });
});

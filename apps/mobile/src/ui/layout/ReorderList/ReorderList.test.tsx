import React from 'react';
import { View } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import { Text } from '../../primitives/Text';
import { ReorderList } from './ReorderList';
import { allowedMove, moveActions } from './reorderModel';
import { renderThemed } from '../../__tests__/themed';

const DATA = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('ReorderList (ML-16)', () => {
  it('only offers allowed moves', () => {
    expect(allowedMove(0, 1, 3)).toBe(true);
    expect(allowedMove(0, -1, 3)).toBe(false);
    expect(allowedMove(1, 2, 3, (_f, t) => t !== 2)).toBe(false);
    expect(moveActions(0, 3)).toEqual([{ name: 'moveDown', label: 'Move down' }]);
    expect(moveActions(1, 3).map((a) => a.name)).toEqual(['moveUp', 'moveDown']);
  });

  it('gives each row a named handle with Move up / Move down while editing', async () => {
    const onMove = jest.fn();
    await renderThemed(
      <ReorderList
        data={DATA}
        keyExtractor={(d) => d.id}
        itemLabel={(d) => `Stage ${d.id}`}
        editing
        onMove={onMove}
        renderItem={(d, handle) => (
          <View>
            <Text>{d.id}</Text>
            {handle}
          </View>
        )}
      />,
    );
    const handle = screen.getByLabelText('Reorder Stage b');
    expect(handle.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(['moveUp', 'moveDown']);
    fireEvent(handle, 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
    expect(onMove).toHaveBeenCalledWith('b', 0);
  });

  it('shows no handles when not editing', async () => {
    await renderThemed(<ReorderList data={DATA} keyExtractor={(d) => d.id} editing={false} onMove={jest.fn()} renderItem={(d, handle) => <View>{handle}<Text>{d.id}</Text></View>} />);
    expect(screen.queryByLabelText('Reorder a')).toBeNull();
  });
});

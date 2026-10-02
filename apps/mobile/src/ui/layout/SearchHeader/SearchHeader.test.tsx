import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderThemed } from '../../__tests__/themed';
import { SearchHeader } from './SearchHeader';
import { resultCountLabel } from './searchHeaderModel';

describe('SearchHeader (ML-28)', () => {
  it('counts results', () => {
    expect(resultCountLabel(1)).toBe('1 result');
    expect(resultCountLabel(9)).toBe('9 results');
  });

  it('types, submits, closes and shows the count once there is a query', async () => {
    const onChangeText = jest.fn();
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    await renderThemed(<SearchHeader value="run" onChangeText={onChangeText} onSubmit={onSubmit} onClose={onClose} placeholder="Search" resultCount={9} />);
    await fireEvent.changeText(screen.getByTestId('search-input'), 'run nig');
    expect(onChangeText).toHaveBeenCalledWith('run nig');
    await fireEvent(screen.getByTestId('search-input'), 'submitEditing');
    expect(onSubmit).toHaveBeenCalled();
    expect(screen.getByText('9 results')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Close search'));
    expect(onClose).toHaveBeenCalled();
  });
});

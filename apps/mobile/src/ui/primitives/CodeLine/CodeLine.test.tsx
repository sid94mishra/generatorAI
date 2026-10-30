import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { CodeLine, codeLineHeight, codeLineLabel } from './CodeLine';
import { renderThemed } from '../../__tests__/themed';

describe('CodeLine (MP-42 rows; MD-61)', () => {
  it('names old and new line numbers in its spoken label', () => {
    expect(codeLineLabel({ kind: 'add', newNumber: 20, text: 'x' })).toBe('Line 20 added: x');
    expect(codeLineLabel({ kind: 'del', oldNumber: 19, text: 'y' })).toBe('Line 19 removed: y');
    expect(codeLineLabel({ kind: 'context', oldNumber: 3, newNumber: 4, text: ' ' })).toBe('Line 4, was 3: empty line');
    expect(codeLineHeight(12)).toBe(18);
  });

  it('comments from the gutter and opens threads from the count chip', async () => {
    const user = userEvent.setup();
    const gutter = jest.fn();
    const threads = jest.fn();
    await renderThemed(<CodeLine text="const a = 1;" kind="add" newNumber={20} gutterWidth={24} fontSize={12} wrap={false} language="ts" commentCount={2} onPressGutter={gutter} onPressComments={threads} />);
    await user.press(screen.getByRole('button', { name: 'Comment on line 20' }));
    await user.press(screen.getByRole('button', { name: '2 review comments on line 20' }));
    expect(gutter).toHaveBeenCalledTimes(1);
    expect(threads).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Line 20 added: const a = 1;')).toBeTruthy();
  });
});

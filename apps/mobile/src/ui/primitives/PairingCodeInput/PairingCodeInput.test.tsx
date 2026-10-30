import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { PairingCodeInput } from './PairingCodeInput';
import { normalizePairingCode, pairingCells, pairingCellWidth, spokenPairingCode } from './pairingCodeModel';
import { renderThemed, themed } from '../../__tests__/themed';

describe('PairingCodeInput (MP-40)', () => {
  it('normalises, groups, sizes cells and spells the value', () => {
    expect(normalizePairingCode('4f7k-2qx9 mb3t-extra')).toBe('4F7K2QX9MB3T');
    expect(pairingCells('4F7K2')).toEqual([['4', 'F', '7', 'K'], ['2', '', '', ''], ['', '', '', '']]);
    expect(pairingCellWidth(370)).toBe(24);
    expect(pairingCellWidth(1000)).toBe(32);
    expect(pairingCellWidth(100)).toBe(22);
    expect(spokenPairingCode('4F7K2Q')).toBe('4 F 7 K, 2 Q');
  });

  it('is one labelled element; paste is normalised; completion fires once and never submits', async () => {
    const onChangeText = jest.fn();
    const onComplete = jest.fn();
    const user = userEvent.setup();
    const { rerender } = await renderThemed(<PairingCodeInput value="" onChangeText={onChangeText} onComplete={onComplete} />);
    const input = screen.getByLabelText('Pairing code, 12 characters');
    await user.paste(input, '4f7k-2qx9-mb3t');
    expect(onChangeText).toHaveBeenLastCalledWith('4F7K2QX9MB3T');
    await rerender(themed(<PairingCodeInput value="4F7K2QX9MB3T" onChangeText={onChangeText} onComplete={onComplete} />));
    await rerender(themed(<PairingCodeInput value="4F7K2QX9MB3T" onChangeText={onChangeText} onComplete={onComplete} />));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Pairing code, 12 characters').props.accessibilityValue).toEqual({ text: '4 F 7 K, 2 Q X 9, M B 3 T' });
  });

  it('announces the error and has no keyboard in the read-only form', async () => {
    const { rerender } = await renderThemed(<PairingCodeInput value="4F7K" onChangeText={jest.fn()} error="That code expired — ask for a new one" />);
    expect(screen.getByText('That code expired — ask for a new one')).toBeTruthy();
    expect(screen.getByLabelText('Pairing code, 12 characters').props.accessibilityHint).toBe('Error: That code expired — ask for a new one');
    await rerender(themed(<PairingCodeInput value="4F7K" onChangeText={jest.fn()} readOnly />));
    expect(screen.getByLabelText('Pairing code, 12 characters').props.accessible).toBe(true);
  });
});

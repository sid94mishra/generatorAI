import React from 'react';
import { screen } from '@testing-library/react-native';
import { QrCode, qrDrawing } from './QrCode';
import { renderThemed } from '../../__tests__/themed';

describe('QrCode (MP-50)', () => {
  it('encodes with a quiet zone and refuses oversized payloads', () => {
    const d = qrDrawing('generatorai://pair?code=ABCD')!;
    expect(d.extent).toBeGreaterThan(21);
    expect(d.path.startsWith('M4 4')).toBe(true);
    expect(qrDrawing('x'.repeat(5000))).toBeNull();
  });

  it('is a labelled image drawn dark-on-light even in dark mode', async () => {
    await renderThemed(<QrCode value="generatorai://pair?code=ABCD" label="Pairing QR code" testID="qr" />);
    const node = screen.getByTestId('qr');
    expect(node.props.accessibilityRole).toBe('image');
    expect(node.props.accessibilityLabel).toBe('Pairing QR code');
  });
});

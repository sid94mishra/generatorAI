import React from 'react';
import { screen } from '@testing-library/react-native';
import { Gauge, gaugeTone } from './Gauge';
import { renderThemed } from '../../__tests__/themed';

describe('Gauge (MP-41)', () => {
  it('switches tone at 80 % and 95 %', () => {
    expect(gaugeTone(0.5)).toBe('fg2');
    expect(gaugeTone(0.8)).toBe('warn');
    expect(gaugeTone(0.96)).toBe('err');
  });
  it('is a progressbar with its value', async () => {
    await renderThemed(<Gauge value={0.42} label="Context window" />);
    expect(screen.getByRole('progressbar', { name: 'Context window' }).props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
  });
});

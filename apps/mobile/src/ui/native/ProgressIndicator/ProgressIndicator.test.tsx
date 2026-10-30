import React from 'react';
import { screen } from '@testing-library/react-native';
import { ProgressIndicator } from './ProgressIndicator';
import { toProgressIndicatorNativeProps } from './progressIndicatorModel';
import { renderThemed } from '../../__tests__/themed';

describe('ProgressIndicator (MP-13)', () => {
  it('maps size, tint and the Android seed (no seed for ink)', () => {
    const ink = { fg: '#ededef', fg2: '#a1a1aa', accent: '#ededef' };
    expect(toProgressIndicatorNativeProps({ label: 'x', size: 'lg' }, ink)).toEqual({ controlSize: 'large', dp: 64, contained: false, color: '#a1a1aa', seedColor: undefined });
    expect(toProgressIndicatorNativeProps({ label: 'x', contained: true }, { ...ink, accent: '#4c8dff' })).toMatchObject({ dp: 48, contained: true, seedColor: '#4c8dff' });
  });
  it('is a busy progressbar with its label', async () => {
    await renderThemed(<ProgressIndicator label="Connecting" />);
    expect(screen.getByRole('progressbar', { name: 'Connecting' }).props.accessibilityState).toMatchObject({ busy: true });
  });
});

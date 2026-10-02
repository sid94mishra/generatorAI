import React from 'react';
import { screen } from '@testing-library/react-native';
import { Stepper } from './Stepper';
import { stepState, stepperLabel } from './stepperModel';
import { renderThemed } from '../../__tests__/themed';

const STEPS = ['Basics', 'Trigger', 'Review'].map((label, i) => ({ id: String(i), label }));

describe('Stepper (ML-21)', () => {
  it('derives states and the spoken step', () => {
    expect([0, 1, 2].map((i) => stepState(i, 1, [0]))).toEqual(['done', 'current', 'pending']);
    expect(stepperLabel(1, 6, 'Trigger')).toBe('Step 2 of 6, Trigger');
  });

  it('reads "Step n of N, label" and shows the current label on phones', async () => {
    await renderThemed(<Stepper steps={STEPS} current={1} done={[0]} testID="st" />);
    expect(screen.getByTestId('st').props.accessibilityLabel).toBe('Step 2 of 3, Trigger');
    expect(screen.getByText('Trigger')).toBeTruthy();
  });
});

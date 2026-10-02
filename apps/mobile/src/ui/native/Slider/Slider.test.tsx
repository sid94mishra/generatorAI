import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { Slider } from './Slider';
import { adjustStep, composeSteps, crossedStop, sliderFraction, sliderValueAt, snapSlider } from './sliderModel';
import { renderThemed } from '../../__tests__/themed';

describe('Slider (MP-25)', () => {
  it('snaps, counts Compose stops and reads touches', () => {
    expect(snapSlider(13.4, 10, 20, 1)).toBe(13);
    expect(snapSlider(25, 10, 20)).toBe(20);
    expect(composeSteps(10, 20, 1)).toBe(9);
    expect(composeSteps(0, 1)).toBe(0);
    expect(sliderValueAt(50, 100, 10, 20, 1)).toBe(15);
    expect(sliderValueAt(25, 100, 0, 100, undefined, true)).toBe(75);
    expect(adjustStep(0, 1)).toBeCloseTo(0.1);
    expect(crossedStop(13, 14, 1)).toBe(true);
    expect(crossedStop(0.1, 0.2)).toBe(false);
    expect(sliderFraction(15, 10, 20)).toBe(0.5);
  });

  it('is one adjustable element that steps by its increment actions', async () => {
    const onValueChange = jest.fn();
    await renderThemed(<Slider label="Terminal font size" value={13} min={10} max={20} step={1} onValueChange={onValueChange} valueText={(v) => `${v} pt`} />);
    const slider = screen.getByLabelText('Terminal font size');
    expect(slider.props.accessibilityRole).toBe('adjustable');
    expect(slider.props.accessibilityValue).toMatchObject({ now: 13, text: '13 pt' });
    fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onValueChange).toHaveBeenCalledWith(14);
  });

  it('ignores actions when disabled', async () => {
    const onValueChange = jest.fn();
    await renderThemed(<Slider label="Volume" value={0.5} min={0} max={1} onValueChange={onValueChange} disabled />);
    fireEvent(screen.getByLabelText('Volume'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

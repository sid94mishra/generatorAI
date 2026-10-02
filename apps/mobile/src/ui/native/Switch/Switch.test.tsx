import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';
import { Switch } from './Switch';
import { toSwitchNativeProps } from './switchModel';
import { renderThemed } from '../../__tests__/themed';

describe('Switch (MP-22)', () => {
  it('maps value, pending and the on colours (MD-48)', () => {
    const colors = { accent: '#4c8dff', onAccent: '#ffffff', lineStrong: '#3a3a40' };
    expect(toSwitchNativeProps({ value: true, onValueChange: jest.fn(), label: 'x' }, colors)).toEqual({ isOn: true, enabled: true, busy: false, onColor: '#4c8dff', onThumb: '#ffffff', offTrack: '#3a3a40' });
    expect(toSwitchNativeProps({ value: false, onValueChange: jest.fn(), label: 'x', pending: true }, colors)).toMatchObject({ enabled: false, busy: true });
  });

  it('is a named switch with its state that reports changes', async () => {
    const onValueChange = jest.fn();
    await renderThemed(<Switch value={false} onValueChange={onValueChange} label="Notifications" />);
    const control = screen.getByLabelText('Notifications');
    expect(control.props.accessibilityRole).toBe('switch');
    expect(control.props.accessibilityState).toMatchObject({ checked: false });
    fireEvent(control, 'valueChange', true);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('is busy and disabled while pending', async () => {
    await renderThemed(<Switch value onValueChange={jest.fn()} label="Notifications" pending />);
    expect(screen.getByLabelText('Notifications').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });
});

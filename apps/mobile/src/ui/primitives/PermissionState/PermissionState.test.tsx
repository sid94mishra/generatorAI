import React from 'react';
import { Linking } from 'react-native';
import { screen, userEvent } from '@testing-library/react-native';
import { nativePlatform } from '../../platform/geometry';
import { PermissionState } from './PermissionState';
import { permissionCopy } from './permissionModel';
import { renderThemed } from '../../__tests__/themed';

describe('PermissionState (MP-35)', () => {
  it('words each status and uses the platform noun', () => {
    expect(permissionCopy('camera', 'undetermined').action).toEqual({ label: 'Allow', kind: 'request' });
    expect(permissionCopy('camera', 'denied')).toMatchObject({ title: 'The camera is off for GeneratorAI', action: { label: 'Open Settings' } });
    expect(permissionCopy('camera', 'restricted').action).toBeNull();
    expect(permissionCopy('scope', 'missing-scope', 'Manage devices').title).toBe('Requires Manage devices');
    expect(permissionCopy('biometrics', 'undetermined').title).toBe(nativePlatform === 'android' ? 'Use fingerprint' : 'Use Face ID');
  });

  it('opens Settings when denied and keeps app-lock on the lock overlay', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const unlock = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <>
        <PermissionState kind="notifications" status="denied" />
        <PermissionState kind="app-lock" status="locked" onRequest={unlock} />
      </>,
    );
    await user.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(open).toHaveBeenCalled();
    expect(screen.getByTestId('app-lock')).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Unlock' }));
    expect(unlock).toHaveBeenCalled();
  });
});

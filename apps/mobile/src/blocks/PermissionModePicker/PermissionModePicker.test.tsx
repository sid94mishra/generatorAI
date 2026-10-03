// MB-47: radio rows strictest first; Bypass locked without admin:settings.
import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';

import { renderThemed } from '../../ui/__tests__/themed';
import { PermissionModePicker } from './PermissionModePicker';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

describe('PermissionModePicker (MB-47)', () => {
  it('chooses a mode', async () => {
    const onValueChange = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<PermissionModePicker value="default" onValueChange={onValueChange} canBypass />);
    await user.press(screen.getByTestId('permission-mode-acceptEdits'));
    expect(onValueChange).toHaveBeenCalledWith('acceptEdits');
  });

  it('locks Bypass without admin access', async () => {
    await renderThemed(<PermissionModePicker value={null} onValueChange={() => undefined} canBypass={false} />);
    expect(screen.getByTestId('permission-mode-bypassPermissions').props.accessibilityHint).toBe('Request admin access');
  });
});

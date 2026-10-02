import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { OfflineState } from './OfflineState';
import { offlineText } from './offlineModel';
import { renderThemed } from '../../__tests__/themed';

describe('OfflineState (MP-34)', () => {
  it('words each state from the shared health copy', () => {
    expect(offlineText({ state: 'reconnecting' })).toBe('Reconnecting…');
    expect(offlineText({ state: 'offline' })).toBe('Offline · showing saved data');
    expect(offlineText({ state: 'unreachable', serverName: 'Studio' })).toBe("Can't reach Studio");
  });

  it('banner is a polite live region with Retry; screen offers Switch server', async () => {
    const onRetry = jest.fn();
    const onSwitchServer = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <>
        <OfflineState form="banner" state="offline" onRetry={onRetry} testID="b" />
        <OfflineState form="screen" state="unreachable" serverName="Studio" address="http://10.0.0.2:3100" onSwitchServer={onSwitchServer} />
      </>,
    );
    expect(screen.getByTestId('b').props.accessibilityLiveRegion).toBe('polite');
    await user.press(screen.getByRole('button', { name: 'Retry' }));
    await user.press(screen.getByRole('button', { name: 'Switch server' }));
    expect(onRetry).toHaveBeenCalled();
    expect(onSwitchServer).toHaveBeenCalled();
    expect(screen.getByText('http://10.0.0.2:3100')).toBeTruthy();
  });
});

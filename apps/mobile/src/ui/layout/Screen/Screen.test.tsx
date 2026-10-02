import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { createPrimaryRegistry } from '../../lib/primaryAction';
import { Button } from '../../primitives/Button';
import { Text } from '../../primitives/Text';
import { TopAppBar } from '../TopAppBar';
import { Screen } from './Screen';
import { screenBody, stateAnnouncement } from './screenModel';
import { renderThemed, themed } from '../../__tests__/themed';

const header = <TopAppBar role="top" title="Chats" />;

describe('Screen (ML-01)', () => {
  it('maps states to bodies and announcements', () => {
    expect(screenBody(undefined)).toBe('content');
    expect(screenBody({ kind: 'loading' })).toBe('spinner');
    expect(screenBody({ kind: 'loading', skeleton: <Text>s</Text> })).toBe('skeleton');
    expect(stateAnnouncement('loading', 'ready')).toBe('Loaded');
    expect(stateAnnouncement('ready', 'error', "Couldn't load chats")).toBe("Couldn't load chats");
    expect(stateAnnouncement('ready', 'ready')).toBeNull();
  });

  it('warns on a second primary (MD-22)', () => {
    const warn = jest.fn();
    const registry = createPrimaryRegistry(warn);
    const a = registry.register('Save');
    registry.register('Run');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Save, Run'));
    a();
  });

  it('renders the header, content and bottom accessory; error state retries', async () => {
    const onRetry = jest.fn();
    const user = userEvent.setup();
    const { rerender } = await renderThemed(
      <Screen header={header} bottomAccessory={<Button label="Create" variant="primary" onPress={jest.fn()} />}>
        <Text>Body</Text>
      </Screen>,
    );
    expect(screen.getByRole('header', { name: 'Chats' })).toBeTruthy();
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    await rerender(
      themed(
        <Screen header={header} state={{ kind: 'error', error: new Error('x'), onRetry, title: "Couldn't load chats" }}>
          <Text>Body</Text>
        </Screen>,
      ),
    );
    expect(screen.queryByText('Body')).toBeNull();
    await user.press(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

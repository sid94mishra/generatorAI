import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { WithFontScale } from '../../storybook/StoryKit';
import { TopAppBar } from './TopAppBar';
import { renderThemed } from '../../__tests__/themed';

describe('TopAppBar (ML-02 Android bar)', () => {
  it('keeps menu-button on the sidebar toggle and caps trailing actions with an overflow menu', async () => {
    const toggle = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <WithFontScale scale={1}>
        <TopAppBar
          role="top"
          title="Chats"
          onSidebarToggle={toggle}
          actions={[
            { id: 'search', icon: 'search', label: 'Search', onPress: jest.fn() },
            { id: 'select', icon: 'check', label: 'Select chats', onPress: jest.fn(), testID: 'chats-select' },
            { id: 'sort', icon: 'sort', label: 'Sort', onPress: jest.fn() },
            { id: 'delete', icon: 'trash', label: 'Delete all', destructive: true, onPress: jest.fn() },
          ]}
        />
      </WithFontScale>,
    );
    await user.press(screen.getByTestId('menu-button'));
    expect(toggle).toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Chats' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More options' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete all' })).toBeNull();
  });

  it('names back after the parent and the pane toggle with its count; modal confirm is text', async () => {
    const back = jest.fn();
    const save = jest.fn();
    const user = userEvent.setup();
    await renderThemed(
      <>
        <TopAppBar role="workspace" title="Fix flaky test" breadcrumb={[{ label: 'Chats', onPress: jest.fn() }]} onBack={back} testIDs={{ back: 'chat-back' }} paneToggle={{ open: false, count: 2, attention: false, onPress: jest.fn() }} />
        <TopAppBar role="modal" title="Edit agent" modal={{ onCancel: jest.fn(), primary: { label: 'Save', onPress: save } }} />
      </>,
    );
    await user.press(screen.getByRole('button', { name: 'Back to Chats' }));
    expect(back).toHaveBeenCalled();
    expect(screen.getByTestId('chat-back')).toBeTruthy();
    expect(screen.getByTestId('pane-toggle').props.accessibilityLabel).toBe('Open workspace pane, 2 changes');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalled();
  });
});

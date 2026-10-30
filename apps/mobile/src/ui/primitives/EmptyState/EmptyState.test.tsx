import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import { EMPTY_STATE_COPY } from '@generatorai/shared/ui-contract';
import { mobileIconDef, type MobileIconConcept } from '@generatorai/design-tokens';
import { EmptyState } from './EmptyState';
import { emptyCopy } from './emptyStateModel';
import { renderThemed } from '../../__tests__/themed';

describe('EmptyState (MP-32)', () => {
  it('every EMPTY_STATE_COPY icon is a registry concept', () => {
    const missing = Object.entries(EMPTY_STATE_COPY).filter(([, copy]) => !mobileIconDef(copy.icon as MobileIconConcept)).map(([key, copy]) => `${key}: ${copy.icon}`);
    expect(missing).toEqual([]);
  });

  it('resolves copy by key with overrides', () => {
    expect(emptyCopy({ copyKey: 'chats' })).toEqual({ icon: 'chats', title: 'No chats yet', description: 'Start a chat to see it here.' });
    expect(emptyCopy({ copyKey: 'chats', title: 'Nothing here' }).title).toBe('Nothing here');
  });

  it('shows the title as a header and one secondary action', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderThemed(<EmptyState copyKey="archivedChats" action={{ label: 'Show all chats', onPress }} />);
    expect(screen.getByRole('header', { name: 'No archived chats' })).toBeTruthy();
    await user.press(screen.getByRole('button', { name: 'Show all chats' }));
    expect(onPress).toHaveBeenCalled();
  });
});

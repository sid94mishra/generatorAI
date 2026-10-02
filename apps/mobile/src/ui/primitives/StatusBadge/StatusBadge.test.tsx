import React from 'react';
import { screen } from '@testing-library/react-native';
import { StatusBadge, statusWord } from './StatusBadge';
import { renderThemed } from '../../__tests__/themed';

describe('StatusBadge (MP-07)', () => {
  it('uses the shared words: chats say Done, labels override', () => {
    expect(statusWord('succeeded', 'chat')).toBe('Done');
    expect(statusWord('succeeded', 'run')).toBe('Succeeded');
    expect(statusWord('skipped', 'run', 'Cancelled')).toBe('Cancelled');
  });

  it('reads word, phase and detail as one text element', async () => {
    await renderThemed(<StatusBadge state="running" phase="Finalizing" detail="Bug Fixer" testID="s" />);
    expect(screen.getByTestId('s').props.accessibilityLabel).toBe('Running, Finalizing, Bug Fixer');
    expect(screen.getByTestId('s').props.className).toContain('bg-run-bg');
  });

  it('speaks the elapsed time', async () => {
    const since = new Date(Date.now() - 65_000).toISOString();
    await renderThemed(<StatusBadge state="running" elapsedSince={since} testID="s" />);
    expect(screen.getByTestId('s').props.accessibilityLabel).toMatch(/^Running, 1 minute 5 seconds$/);
  });
});

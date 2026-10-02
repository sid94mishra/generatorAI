import React from 'react';
import { Text } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderThemed, themed } from '../../__tests__/themed';
import { PaneTabStrip } from '../PaneTabStrip';
import { PaneShell } from './PaneShell';

const tabs = <PaneTabStrip tabs={[{ id: 'files', type: 'files', label: 'Files', icon: 'files' }]} active="files" onSelect={jest.fn()} accessibilityLabel="Workspace tabs" />;

describe('PaneShell (ML-07)', () => {
  it('renders the header controls and switches the full-screen label', async () => {
    const onClose = jest.fn();
    const onToggle = jest.fn();
    const view = await renderThemed(
      <PaneShell title="Workspace" subtitle="Fix flaky checkout test" mode="overlay" onToggleFullscreen={onToggle} onClose={onClose} tabs={tabs}>
        <Text>body</Text>
      </PaneShell>,
    );
    expect(screen.getByText('Fix flaky checkout test')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open full screen'));
    expect(onToggle).toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Close pane'));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByLabelText('Back to chat')).toBeNull();
    await view.rerender(
      themed(
        <PaneShell title="Workspace" mode="fullscreen" onToggleFullscreen={onToggle} onClose={onClose} onBackToChat={jest.fn()} tabs={tabs}>
          <Text>body</Text>
        </PaneShell>,
      ),
    );
    expect(screen.getByLabelText('Exit full screen')).toBeTruthy();
    expect(screen.getByLabelText('Back to chat')).toBeTruthy();
  });
});

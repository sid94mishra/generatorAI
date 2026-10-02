import React from 'react';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderThemed } from '../../__tests__/themed';
import { PaneTabStrip } from './PaneTabStrip';
import { paneTabLabel, paneTabTestID } from './paneTabModel';

describe('PaneTabStrip (ML-08)', () => {
  it('names tabs with their count and needs-you state; ids are pane-tab-<type> (MD-95)', () => {
    expect(paneTabLabel({ label: 'Changes', count: 2 })).toBe('Changes, 2');
    expect(paneTabLabel({ label: 'Plan', attention: true })).toBe('Plan, needs you');
    expect(paneTabTestID({ type: 'terminal', id: 't2' }, 'tabs')).toBe('pane-tab-terminal');
    expect(paneTabTestID({ type: 'terminal', id: 't2' }, 'instanceChips')).toBe('pane-instance-t2');
  });

  it('is a tablist whose tabs carry the selected state and switch on tap', async () => {
    const onSelect = jest.fn();
    await renderThemed(
      <PaneTabStrip
        tabs={[
          { id: 'changes', type: 'changes', label: 'Changes', icon: 'changes', count: 2 },
          { id: 'files', type: 'files', label: 'Files', icon: 'files' },
        ]}
        active="changes"
        onSelect={onSelect}
        accessibilityLabel="Workspace tabs"
      />,
    );
    expect(screen.getByTestId('pane-tab-changes').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('Changes, 2')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('pane-tab-files'));
    expect(onSelect).toHaveBeenCalledWith('files');
  });

  it('hides the add control at the cap in the chip variant', async () => {
    await renderThemed(
      <PaneTabStrip tabs={[{ id: 't1', type: 'terminal', label: 'pwsh', icon: 'terminal' }]} active="t1" onSelect={jest.fn()} variant="instanceChips" accessibilityLabel="Terminals" addLabel="New terminal" />,
    );
    expect(screen.queryByLabelText('New terminal')).toBeNull();
    expect(screen.getByTestId('pane-instance-t1')).toBeTruthy();
  });
});

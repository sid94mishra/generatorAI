import { describe, expect, it } from 'vitest';
import { addTab, closePane, createWorkbench, splitPane, activeTab, leaves } from '../PaneModel.js';

const dashboard = { kind: 'dashboard' as const, title: 'Dashboard' };

describe('closePane', () => {
  it('closes the whole tab when its last pane goes', () => {
    let state = createWorkbench(dashboard);
    state = addTab(state, { kind: 'chat', entityId: 'c1', title: 'Test' });
    expect(state.tabs).toHaveLength(2);

    state = closePane(state);

    // The chat tab held exactly one pane, so closing it must close the tab —
    // otherwise Esc appears to do nothing at all.
    expect(state.tabs).toHaveLength(1);
    expect(activeTab(state).title).not.toBe('Test');
  });

  it('keeps the tab when a split still has a sibling', () => {
    let state = createWorkbench(dashboard);
    state = addTab(state, { kind: 'chat', entityId: 'c1', title: 'Test' });
    state = splitPane(state, { kind: 'runs', title: 'Runs' }, 'vertical');
    expect(leaves(activeTab(state).root)).toHaveLength(2);

    state = closePane(state);
    expect(state.tabs).toHaveLength(2);
    expect(leaves(activeTab(state).root)).toHaveLength(1);
  });

  it('never closes the last remaining tab out from under the user', () => {
    let state = createWorkbench(dashboard);
    state = closePane(state);
    expect(state.tabs.length).toBeGreaterThanOrEqual(1);
  });
});

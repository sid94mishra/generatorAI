// ────────────────────────────────────────────────────────────────
// RightPane — P4-01 characterization (docs/redesign/09-verification.md §5.5,
// docs/redesign/03-component-inventory-domain.md §6.5).
//
// The existing suites (`__tests__/components/RightPane.test.tsx` and
// `RightPanePanels.test.tsx`) already pin: one active tab, panels stay
// mounted while inactive, instance caps + the cap notice, the narrow sheet +
// Escape, the width clamp + keyboard resize, and memoised panels. This file
// covers only the REMAINING "Add:" items from §5.5 — it does not repeat any
// scenario already green in those two files.
//
// RightPane moves to `ui/shell/DockFrame` + `ui/shell/DockTabStrip` +
// `blocks/dock/useDockState.ts` + `features/chat/ChatDock.tsx` in P4-02..04
// (03 §6.5). Every assertion here must survive that split unchanged — only
// the import line below changes.
//
// Mocking: RightPane has no data-layer imports of its own (no stores,
// platform, react-query). Nothing is mocked; matchMedia/ResizeObserver/
// scrollIntoView come from apps/web/vitest.setup.ts, and geometry
// (offsetLeft/offsetWidth/clientWidth/scrollLeft) is stubbed per-test where
// the component's own measurement code reads it.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
// Import under test — the only line that changes when P4 moves the file.
// P4-06: the chat's right pane is now the dock (blocks/dock); legacy RightPane stays for the run page.
import { Dock as RightPane, type DockTabDef as RightPaneTabDef, type DockPanelProps as RightPanePanelProps } from '@/blocks/dock/index.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
});

/**
 * Shared tab fixtures: a singleton `changes` default and a multi-instance
 * `terminal` kind. Each panel body renders a per-id testid so instances of
 * the same type (which share a `data-testid` on the tab strip and the
 * panel host — RightPane.tsx:129,714) can still be told apart from outside.
 *
 * `labelBy: 'index'` gives ordinal labels ("T1", "T2", …) for tests that
 * care about add-order. `labelBy: 'id'` gives labels equal to the tab's own
 * id for tests that address one specific instance.
 */
function makeTabs(opts: { maxInstances?: number; labelBy?: 'index' | 'id' } = {}): Record<string, RightPaneTabDef> {
  const { maxInstances = 6, labelBy = 'index' } = opts;
  const ChangesPanel = React.memo(function ChangesPanel({ id, active }: RightPanePanelProps) {
    return <div data-testid={`panel-body-${id}`}>{active ? 'live' : 'hidden'}</div>;
  });
  const TerminalPanel = React.memo(function TerminalPanel({ id, active }: RightPanePanelProps) {
    return <div data-testid={`panel-body-${id}`}>{active ? 'live' : 'hidden'}</div>;
  });
  return {
    // P4-06: dock tab icons are ui/icons concepts (C-19), not elements.
    changes: { label: 'Changes', icon: 'changes', Component: ChangesPanel },
    terminal: {
      label: 'Terminal',
      icon: 'terminal',
      allowMultiple: true,
      maxInstances,
      getTabLabel: labelBy === 'id' ? ({ id }) => id : ({ index }) => `T${index}`,
      Component: TerminalPanel,
    },
  };
}

function addTerminal() {
  fireEvent.click(screen.getByTestId('right-pane-add-tab'));
  fireEvent.click(screen.getByTestId('right-pane-add-terminal'));
}

describe('RightPane characterization — default tab identity (RightPane.tsx:693,728)', () => {
  it('the default tab renders first and never gets a close button', () => {
    const tabs = makeTabs();
    render(
      <RightPane open onOpenChange={() => {}} storageKey="default-first" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    addTerminal();
    const allTabs = screen.getAllByRole('tab');
    expect(allTabs[0]).toHaveAttribute('data-testid', 'right-pane-tab-changes');
    expect(screen.queryByLabelText('Close Changes tab')).toBeNull();
    // A non-default instance DOES get one — confirms the assertion above is
    // about the default tab specifically, not a missing feature.
    expect(screen.getByLabelText('Close T1 tab')).toBeTruthy();
  });
});

describe('RightPane characterization — closing the active tab (RightPane.tsx:425-442)', () => {
  it('selects the previous tab, not the first or the next', () => {
    const tabs = makeTabs();
    render(
      <RightPane open onOpenChange={() => {}} storageKey="close-active" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    addTerminal(); // T1
    addTerminal(); // T2
    addTerminal(); // T3, active
    expect(screen.getByRole('tab', { name: 'T3' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByLabelText('Close T3 tab'));

    expect(screen.queryByRole('tab', { name: 'T3' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'T2' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('RightPane characterization — onTabClose ordering (RightPane.tsx:429-441)', () => {
  it('is invoked after the removal is scheduled, before it is committed to the DOM', () => {
    const tabs = makeTabs();
    let sawPanelStillMounted = false;
    const onTabClose = vi.fn((closing: { id: string; type: string }) => {
      // Source order: closeTab calls setState(...) first, THEN
      // onTabCloseRef.current?.(closing) — see RightPane.tsx:429-441. React 18
      // batches the state update inside this click handler, so at the instant
      // this callback runs the removal is scheduled but not yet painted: the
      // panel for the closing tab is still in the DOM.
      sawPanelStillMounted = !!document.querySelector(`[data-testid="panel-body-${closing.id}"]`);
    });
    render(
      <RightPane open onOpenChange={() => {}} storageKey="close-order" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} onTabClose={onTabClose} />,
    );
    addTerminal(); // T1

    fireEvent.click(screen.getByLabelText('Close T1 tab'));

    expect(onTabClose).toHaveBeenCalledTimes(1);
    expect(onTabClose).toHaveBeenCalledWith(expect.objectContaining({ type: 'terminal' }));
    expect(sawPanelStillMounted).toBe(true);
    // …and by the time the click event has fully settled, the removal HAS
    // landed — proving the callback really did run ahead of the commit
    // rather than the assertion above being a false positive.
    expect(screen.queryByTestId('right-pane-panel-terminal')).toBeNull();
  });
});

describe('RightPane characterization — reconcileState via stored localStorage state (RightPane.tsx:198-228)', () => {
  it('drops tabs whose type is no longer defined', () => {
    window.localStorage.setItem(
      'reconcile-unknown',
      JSON.stringify({ tabs: [{ id: 'ghost-1', type: 'ghost' }], active: 'ghost-1' }),
    );
    const tabs = makeTabs({ labelBy: 'id' });
    render(
      <RightPane open onOpenChange={() => {}} storageKey="reconcile-unknown" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true');
  });

  it('reinserts the required default as the first tab when it is missing from storage', () => {
    window.localStorage.setItem(
      'reconcile-missing-default',
      JSON.stringify({ tabs: [{ id: 'terminal-1', type: 'terminal' }], active: 'terminal-1' }),
    );
    const tabs = makeTabs({ labelBy: 'id' });
    render(
      <RightPane open onOpenChange={() => {}} storageKey="reconcile-missing-default" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    const all = screen.getAllByRole('tab');
    expect(all).toHaveLength(2);
    expect(all[0]).toHaveAttribute('data-testid', 'right-pane-tab-changes');
    // The previously-stored active tab is preserved (it was valid).
    expect(screen.getByRole('tab', { name: 'terminal-1' })).toHaveAttribute('aria-selected', 'true');
  });

  it('falls back to the first tab when the stored active id no longer exists', () => {
    window.localStorage.setItem(
      'reconcile-stale-active',
      JSON.stringify({
        tabs: [{ id: 'changes-1', type: 'changes' }, { id: 'terminal-1', type: 'terminal' }],
        active: 'terminal-999',
      }),
    );
    const tabs = makeTabs({ labelBy: 'id' });
    render(
      <RightPane open onOpenChange={() => {}} storageKey="reconcile-stale-active" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    expect(screen.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'terminal-1' })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('RightPane characterization — storageKey scope switch (RightPane.tsx:267-277)', () => {
  it('paints the new scope on the first committed frame, with no interim frame of the old scope', () => {
    window.localStorage.setItem(
      'scope-a',
      JSON.stringify({
        tabs: [{ id: 'changes-1', type: 'changes' }, { id: 'terminal-1', type: 'terminal' }],
        active: 'changes-1',
      }),
    );
    window.localStorage.setItem(
      'scope-b',
      JSON.stringify({ tabs: [{ id: 'changes-1', type: 'changes' }], active: 'changes-1' }),
    );
    const tabs = makeTabs({ labelBy: 'id' });
    const { rerender } = render(
      <RightPane open onOpenChange={() => {}} storageKey="scope-a" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(2);

    rerender(
      <RightPane open onOpenChange={() => {}} storageKey="scope-b" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    // Checked synchronously, in the same act() as `rerender` (no waitFor):
    // the render-phase state adjustment (RightPane.tsx:274-276) resolves
    // scope-b's data before this call returns, so there is no committed
    // frame anywhere in between that still shows scope-a's terminal tab.
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });
});

describe('RightPane characterization — instance cap (RightPane.tsx:448-507)', () => {
  it('at the cap, the OLDEST instance is focused and the notice clears after 6s', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const tabs = makeTabs({ maxInstances: 2 });
    const { rerender } = render(
      <RightPane open onOpenChange={() => {}} storageKey="cap-oldest" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    addTerminal(); // T1
    addTerminal(); // T2, active — cap reached, the "+" menu's Terminal entry now hides itself.
    expect(screen.getByRole('tab', { name: 'T2' })).toHaveAttribute('aria-selected', 'true');

    // With the "+" entry hidden, the only reachable way to exercise the cap
    // path from outside is an imperative focus request for a not-yet-open
    // id — same "announce outside the updater, then setState" shape as
    // addTab's own cap branch (RightPane.tsx:396-402 vs 461-466).
    rerender(
      <RightPane open onOpenChange={() => {}} storageKey="cap-oldest" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']}
        focusTabRequest={{ type: 'terminal', token: 1, tabId: 'terminal-new' }} />,
    );

    expect(screen.getAllByTestId('right-pane-tab-terminal')).toHaveLength(2); // nothing added
    expect(screen.getByRole('tab', { name: 'T1' })).toHaveAttribute('aria-selected', 'true'); // oldest, not T2
    const notice = screen.getByTestId('right-pane-cap-notice');
    expect(notice.textContent).toMatch(/2 Terminal tabs is the limit/);

    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByTestId('right-pane-cap-notice')).toBeNull();
  });
});

describe('RightPane characterization — focusTabRequest (RightPane.tsx:452-507)', () => {
  it('an explicit tabId focuses that exact instance without creating a duplicate', () => {
    window.localStorage.setItem(
      'explicit-focus',
      JSON.stringify({
        tabs: [
          { id: 'changes-1', type: 'changes' },
          { id: 'terminal-a', type: 'terminal' },
          { id: 'terminal-b', type: 'terminal' },
        ],
        active: 'changes-1',
      }),
    );
    const tabs = makeTabs({ labelBy: 'id' });
    render(
      <RightPane open onOpenChange={() => {}} storageKey="explicit-focus" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']}
        focusTabRequest={{ type: 'terminal', token: 1, tabId: 'terminal-b' }} />,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3); // no duplicate created
    expect(screen.getByRole('tab', { name: 'terminal-b' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'terminal-a' })).toHaveAttribute('aria-selected', 'false');
  });

  it('is idempotent per token — a re-render with a new object but the same token is a no-op', () => {
    window.localStorage.setItem(
      'idempotent-focus',
      JSON.stringify({
        tabs: [
          { id: 'changes-1', type: 'changes' },
          { id: 'terminal-a', type: 'terminal' },
          { id: 'terminal-b', type: 'terminal' },
        ],
        active: 'changes-1',
      }),
    );
    const tabs = makeTabs({ labelBy: 'id' });
    const { rerender } = render(
      <RightPane open onOpenChange={() => {}} storageKey="idempotent-focus" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']}
        focusTabRequest={{ type: 'terminal', token: 1, tabId: 'terminal-b' }} />,
    );
    expect(screen.getByRole('tab', { name: 'terminal-b' })).toHaveAttribute('aria-selected', 'true');

    // The user moves away from the focused tab...
    fireEvent.click(screen.getByRole('tab', { name: 'terminal-a' }));
    expect(screen.getByRole('tab', { name: 'terminal-a' })).toHaveAttribute('aria-selected', 'true');

    // ...and a NEW request object with the SAME token arrives (e.g. the
    // parent recomputed the object on a re-render without minting a new
    // token). lastFocusTokenRef already consumed token 1, so this must not
    // re-focus terminal-b.
    rerender(
      <RightPane open onOpenChange={() => {}} storageKey="idempotent-focus" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']}
        focusTabRequest={{ type: 'terminal', token: 1, tabId: 'terminal-b' }} />,
    );
    expect(screen.getByRole('tab', { name: 'terminal-a' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('RightPane characterization — fullscreen exits when the pane closes (RightPane.tsx:612-616)', () => {
  it('resets fullscreen while closed so it reopens at normal width', () => {
    const tabs = makeTabs();
    const { rerender } = render(
      <RightPane open onOpenChange={() => {}} storageKey="fs-close" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    fireEvent.click(screen.getByTestId('right-pane-fullscreen'));
    expect(screen.getByTestId('right-pane').dataset['fullscreen']).toBe('true');

    rerender(
      <RightPane open={false} onOpenChange={() => {}} storageKey="fs-close" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    // P4-06 (D-27): closing collapses the dock instead of unmounting it.
    expect(screen.getByTestId('right-pane')).toHaveAttribute('data-state', 'closed');

    rerender(
      <RightPane open onOpenChange={() => {}} storageKey="fs-close" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    expect(screen.getByTestId('right-pane').dataset['fullscreen']).toBeUndefined();
  });
});

describe('RightPane characterization — narrow breakpoint boundary (RightPane.tsx:296-310)', () => {
  it('the host-width path is strictly "< 760", not "<= 760"', async () => {
    const tabs = makeTabs();
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get');

    clientWidthSpy.mockReturnValue(760);
    const first = render(
      <RightPane open onOpenChange={() => {}} storageKey="boundary-760" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    await waitFor(() => expect(screen.getByTestId('right-pane').dataset['narrow']).toBeUndefined());
    first.unmount();

    clientWidthSpy.mockReturnValue(759);
    render(
      <RightPane open onOpenChange={() => {}} storageKey="boundary-759" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    await waitFor(() => expect(screen.getByTestId('right-pane').dataset['narrow']).toBe('true'));
  });

  it('in narrow mode there is no resize handle and no fullscreen toggle', async () => {
    const tabs = makeTabs();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    render(
      <RightPane open onOpenChange={() => {}} storageKey="boundary-no-controls" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    await waitFor(() => expect(screen.getByTestId('right-pane').dataset['narrow']).toBe('true'));
    expect(screen.queryByLabelText('Resize right pane')).toBeNull();
    expect(screen.queryByTestId('right-pane-fullscreen')).toBeNull();
  });
});

describe('RightPane characterization — Escape vs. dialog guard, desktop fullscreen (RightPane.tsx:618-634)', () => {
  it('is ignored when the topmost node of composedPath is a dialog or alertdialog, otherwise exits fullscreen', () => {
    const tabs = makeTabs();
    render(
      <RightPane open onOpenChange={() => {}} storageKey="esc-fullscreen" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    fireEvent.click(screen.getByTestId('right-pane-fullscreen'));
    expect(screen.getByTestId('right-pane').dataset['fullscreen']).toBe('true');

    const alertDialog = document.createElement('div');
    alertDialog.setAttribute('role', 'alertdialog');
    const input = document.createElement('input');
    alertDialog.append(input);
    document.body.append(alertDialog);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByTestId('right-pane').dataset['fullscreen']).toBe('true'); // ignored
    alertDialog.remove();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('right-pane').dataset['fullscreen']).toBeUndefined(); // real Escape exits
  });
});

describe('RightPane characterization — inactive panel visibility contract, D-27 (RightPane.tsx:126-141)', () => {
  it('hides inactive panels with visibility:hidden + aria-hidden, never display:none', () => {
    const tabs = makeTabs();
    render(
      <RightPane open onOpenChange={() => {}} storageKey="visibility" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    addTerminal();

    const panels = screen.getAllByTestId(/^right-pane-panel-/);
    expect(panels).toHaveLength(2);
    const active = panels.find((p) => p.getAttribute('aria-hidden') === 'false');
    const inactive = panels.find((p) => p.getAttribute('aria-hidden') === 'true');
    expect(active).toBeTruthy();
    expect(inactive).toBeTruthy();

    // NativeBrowserView.isContainerHidden() walks ancestors testing
    // `visibility`, not `display` — a display:none ancestor would make the
    // check unreliable in a different way. Tailwind's `invisible` utility is
    // visibility:hidden; `hidden` (which this must never carry) is display:none.
    expect(inactive!.className).toContain('invisible');
    expect(active!.className).not.toContain('invisible');
    expect(inactive!.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(active!.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });
});

describe('RightPane characterization — tab-strip overflow menu (RightPane.tsx:537-572)', () => {
  it('lists a tab only once it is clipped by more than the 2px layout tolerance', () => {
    const tabs = makeTabs();
    render(
      <RightPane open onOpenChange={() => {}} storageKey="overflow" tabs={tabs}
        defaultTabType="changes" addableTabTypes={['terminal']} />,
    );
    addTerminal(); // T1

    const list = screen.getByRole('tablist', { name: 'Right pane tabs' });
    Object.defineProperty(list, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(list, 'scrollLeft', { configurable: true, value: 0, writable: true });

    const changesEl = screen.getByTestId('right-pane-tab-changes').parentElement!;
    Object.defineProperty(changesEl, 'offsetLeft', { configurable: true, value: 0 });
    Object.defineProperty(changesEl, 'offsetWidth', { configurable: true, value: 0 });

    const t1El = screen.getByTestId('right-pane-tab-terminal').parentElement!;
    Object.defineProperty(t1El, 'offsetLeft', { configurable: true, value: 0 });
    // end = 301, i.e. 1px past the strip's right edge (300) — within TOL(2).
    Object.defineProperty(t1El, 'offsetWidth', { configurable: true, value: 301 });
    fireEvent.scroll(list);
    expect(screen.getByTestId('right-pane-add-tab')).toHaveAttribute('aria-label', 'Add tab');

    // end = 303, i.e. 3px past — over the tolerance, so it now counts.
    Object.defineProperty(t1El, 'offsetWidth', { configurable: true, value: 303 });
    fireEvent.scroll(list);

    // P4-06 (C-19): clipped tabs are listed in the "+" menu, whose name counts them
    // (the separate `right-pane-tab-overflow` button is gone).
    const overflowBtn = screen.getByTestId('right-pane-add-tab');
    expect(overflowBtn).toHaveAttribute('aria-label', 'Add tab, 1 more');
    fireEvent.click(overflowBtn);
    expect(screen.getByTestId('right-pane-overflow-terminal').textContent).toContain('T1');
  });
});

describe('RightPane characterization — cap check outside the state updater, StrictMode (RightPane.tsx:461-466)', () => {
  it('a cap-triggered focus request under StrictMode announces once and adds nothing', () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const tabs = makeTabs({ maxInstances: 2 });
    const { rerender } = render(
      <React.StrictMode>
        <RightPane open onOpenChange={() => {}} storageKey="strict-cap" tabs={tabs}
          defaultTabType="changes" addableTabTypes={['terminal']} />
      </React.StrictMode>,
    );
    addTerminal(); // T1
    addTerminal(); // T2 — at cap; the "+" menu's Terminal entry now hides itself
    setTimeoutSpy.mockClear();
    expect(screen.getAllByTestId('right-pane-tab-terminal')).toHaveLength(2);

    // With the "+" entry hidden, the reachable cap path is the imperative
    // focus request (RightPane.tsx:461-466) — architecturally identical to
    // addTab's own cap branch (393-402): the refusal is announced OUTSIDE
    // the state updater. If it were announced INSIDE a setState updater
    // instead, StrictMode's double-invocation of updater functions would
    // schedule the notice's `setTimeout` twice for this single request.
    rerender(
      <React.StrictMode>
        <RightPane open onOpenChange={() => {}} storageKey="strict-cap" tabs={tabs}
          defaultTabType="changes" addableTabTypes={['terminal']}
          focusTabRequest={{ type: 'terminal', token: 1, tabId: 'terminal-new' }} />
      </React.StrictMode>,
    );

    expect(screen.getAllByTestId('right-pane-tab-terminal')).toHaveLength(2); // nothing added
    expect(screen.getAllByTestId('right-pane-cap-notice')).toHaveLength(1); // announced once
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1); // the notice's auto-clear timer, scheduled once
  });
});

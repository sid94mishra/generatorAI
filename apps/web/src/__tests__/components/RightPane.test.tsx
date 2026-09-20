// ────────────────────────────────────────────────────────────────
// RightPane — P1-50 (hidden tabs are not live) and P2-54 / N7 (instance
// caps, and a cap that says so).
//
// The pane mounts EVERY tab and hides the inactive ones; that is deliberate
// and is what keeps a terminal's scrollback alive across tab switches. What
// was missing is any way for a panel to know it is the hidden one, so five
// browser tabs each kept a live socket. These tests pin the flag and the caps.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { RightPane, type RightPaneTabDef } from '@/components/layout/RightPane.js';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

/** Records the `active` flag every render pass hands each tab instance. */
function makeTabs(onRender: (ctx: { id: string; active: boolean }) => void) {
  const term: RightPaneTabDef = {
    label: 'Terminal',
    icon: <span />,
    allowMultiple: true,
    maxInstances: 4,
    render: (ctx) => {
      onRender({ id: ctx.id, active: ctx.active });
      return <div data-testid={`body-${ctx.id}`}>{ctx.active ? 'live' : 'hidden'}</div>;
    },
  };
  const changes: RightPaneTabDef = {
    label: 'Changes',
    icon: <span />,
    render: (ctx) => {
      onRender({ id: ctx.id, active: ctx.active });
      return <div data-testid={`body-${ctx.id}`}>changes</div>;
    },
  };
  return { changes, terminal: term };
}

function renderPane(onRender: (ctx: { id: string; active: boolean }) => void, key = 'k1') {
  return render(
    <RightPane
      open
      onOpenChange={() => {}}
      storageKey={key}
      tabs={makeTabs(onRender)}
      defaultTabType="changes"
      addableTabTypes={['terminal']}
    />,
  );
}

describe('RightPane — P1-50 active flag', () => {
  it('renders exactly one tab as active and the rest as hidden', () => {
    const seen: Array<{ id: string; active: boolean }> = [];
    renderPane((ctx) => seen.push(ctx));

    // Open three terminals; the last one added becomes active.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByTestId('right-pane-add-tab'));
      fireEvent.click(screen.getByTestId('right-pane-add-terminal'));
    }

    const lastPass = new Map<string, boolean>();
    for (const s of seen) lastPass.set(s.id, s.active);
    const actives = [...lastPass.values()].filter(Boolean);
    expect(lastPass.size).toBe(4); // changes + 3 terminals
    expect(actives).toHaveLength(1);
  });

  it('flips the flag when the user switches tabs — every tab stays mounted', () => {
    const seen: Array<{ id: string; active: boolean }> = [];
    renderPane((ctx) => seen.push(ctx));
    fireEvent.click(screen.getByTestId('right-pane-add-tab'));
    fireEvent.click(screen.getByTestId('right-pane-add-terminal'));

    // The terminal is active; the Changes body is still in the DOM.
    expect(screen.getByTestId('body-changes-1').textContent).toBe('changes');
    const terminalId = [...new Set(seen.map((s) => s.id))].find((id) => id !== 'changes-1')!;
    expect(screen.getByTestId(`body-${terminalId}`).textContent).toBe('live');

    fireEvent.click(screen.getByTestId('right-pane-tab-changes'));
    expect(screen.getByTestId(`body-${terminalId}`).textContent).toBe('hidden');
  });
});

describe('RightPane — P2-54 / N7 instance cap', () => {
  it('stops adding at maxInstances', () => {
    renderPane(() => {});
    for (let i = 0; i < 8; i++) {
      const add = screen.queryByTestId('right-pane-add-tab');
      if (!add || (add as HTMLButtonElement).disabled) break;
      fireEvent.click(add);
      const item = screen.queryByTestId('right-pane-add-terminal');
      if (!item) break;
      fireEvent.click(item);
    }
    expect(screen.getAllByTestId('right-pane-tab-terminal')).toHaveLength(4);
  });

  it('refuses out loud instead of silently doing nothing', () => {
    // The "+" entry disappears at the cap, so drive the same path the way a
    // programmatic focus request does — via an explicit tab id.
    const { rerender } = render(
      <RightPane
        open
        onOpenChange={() => {}}
        storageKey="cap"
        tabs={makeTabs(() => {})}
        defaultTabType="changes"
        addableTabTypes={['terminal']}
      />,
    );
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByTestId('right-pane-add-tab'));
      fireEvent.click(screen.getByTestId('right-pane-add-terminal'));
    }
    expect(screen.getAllByTestId('right-pane-tab-terminal')).toHaveLength(4);
    expect(screen.queryByTestId('right-pane-cap-notice')).toBeNull();

    rerender(
      <RightPane
        open
        onOpenChange={() => {}}
        storageKey="cap"
        tabs={makeTabs(() => {})}
        defaultTabType="changes"
        addableTabTypes={['terminal']}
        focusTabRequest={{ type: 'terminal', token: 1, tabId: 'terminal-new' }}
      />,
    );

    expect(screen.getAllByTestId('right-pane-tab-terminal')).toHaveLength(4);
    const notice = screen.getByTestId('right-pane-cap-notice');
    expect(notice.textContent).toMatch(/4 Terminal tabs is the limit/);
  });

  it('an uncapped tab kind keeps adding', () => {
    const tabs = makeTabs(() => {});
    delete (tabs.terminal as { maxInstances?: number }).maxInstances;
    render(
      <RightPane
        open
        onOpenChange={() => {}}
        storageKey="uncapped"
        tabs={tabs}
        defaultTabType="changes"
        addableTabTypes={['terminal']}
      />,
    );
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByTestId('right-pane-add-tab'));
      fireEvent.click(screen.getByTestId('right-pane-add-terminal'));
    }
    expect(screen.getAllByTestId('right-pane-tab-terminal')).toHaveLength(6);
  });
});


describe('RightPane — constrained desktop layout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses an escapable sheet when the sidebar leaves too little room for two columns', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(620);
    const close = vi.fn();
    render(<div><RightPane open onOpenChange={close} storageKey="narrow-host"
      tabs={makeTabs(() => {})} defaultTabType="changes" addableTabTypes={['terminal']} /></div>);
    await waitFor(() => expect(screen.getByTestId('right-pane').getAttribute('data-fullscreen')).toBe('true'));
    expect(screen.queryByRole('separator')).toBeNull();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const input = document.createElement('textarea');
    dialog.append(input);
    document.body.append(dialog);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    dialog.remove();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledWith(false);
  });

  it('caps persisted width to preserve reading space and supports keyboard resizing', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    window.localStorage.setItem('keyboard-pane:width', '900');
    renderPane(() => {}, 'keyboard-pane');
    await waitFor(() => expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('580'));
    const divider = screen.getByRole('separator');
    expect(divider.tabIndex).toBe(0);
    fireEvent.keyDown(divider, { key: 'Home' });
    expect(divider.getAttribute('aria-valuenow')).toBe('320');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider.getAttribute('aria-valuenow')).toBe('336');
    fireEvent.keyDown(divider, { key: 'End' });
    expect(divider.getAttribute('aria-valuenow')).toBe('580');
  });
});

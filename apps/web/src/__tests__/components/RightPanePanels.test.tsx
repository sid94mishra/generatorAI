// ────────────────────────────────────────────────────────────────
// RightPane — review 6.4 / plan item 18 (panels are real components) and the
// narrow-viewport sheet the fact-check found missing.
//
// The cascade: the chat page re-rendered on every streamed token, passed a
// fresh inline `tabs` object, and the pane called `def.render()` as a plain
// function — so every mounted panel, visible or not, rebuilt per frame. With
// `Component` defs rendered as JSX through a memoised host, a parent
// re-render with unchanged defs must reach zero panels. Revert the
// `RightPanePanel` host (or go back to calling `render()` inline) and the
// first test fails.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  RightPane,
  type RightPaneTabDef,
  type RightPanePanelProps,
} from '@/components/layout/RightPane.js';
import { NARROW_VIEWPORT_QUERY } from '@/hooks/useMediaQuery.js';

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
});

/** Build memoised panel components that count their own renders. */
function makeCountingTabs() {
  const counts: Record<string, number> = {};
  const bump = (name: string) => {
    counts[name] = (counts[name] ?? 0) + 1;
  };
  const ChangesPanel = React.memo(function ChangesPanel({ active }: RightPanePanelProps) {
    bump('changes');
    return <div data-testid="changes-body">{active ? 'live' : 'hidden'}</div>;
  });
  const TerminalPanel = React.memo(function TerminalPanel({ id, active }: RightPanePanelProps) {
    bump(id);
    return <div data-testid={`term-body-${id}`}>{active ? 'live' : 'hidden'}</div>;
  });
  // Module-stable defs: this is what a page's `useMemo` produces.
  const tabs: Record<string, RightPaneTabDef> = {
    changes: { label: 'Changes', icon: <span />, Component: ChangesPanel },
    terminal: { label: 'Terminal', icon: <span />, allowMultiple: true, maxInstances: 4, Component: TerminalPanel },
  };
  return { counts, tabs };
}

/** A parent that re-renders on demand — stands in for ChatPage on a token frame. */
function Host({ tabs, onOpenChange = () => {} }: { tabs: Record<string, RightPaneTabDef>; onOpenChange?: (o: boolean) => void }) {
  const [, setTick] = useState(0);
  return (
    <div>
      <button data-testid="tick" onClick={() => setTick((t) => t + 1)}>tick</button>
      <RightPane
        open
        onOpenChange={onOpenChange}
        storageKey="panels-test"
        tabs={tabs}
        defaultTabType="changes"
        addableTabTypes={['terminal']}
      />
    </div>
  );
}

describe('RightPane — panels are memoised component boundaries', () => {
  it('a parent re-render with unchanged defs re-renders NO panel', () => {
    const { counts, tabs } = makeCountingTabs();
    render(<Host tabs={tabs} />);
    // Two terminals so there are inactive panels to protect.
    fireEvent.click(screen.getByTestId('right-pane-add-tab'));
    fireEvent.click(screen.getByTestId('right-pane-add-terminal'));
    fireEvent.click(screen.getByTestId('right-pane-add-tab'));
    fireEvent.click(screen.getByTestId('right-pane-add-terminal'));
    const before = { ...counts };
    expect(Object.keys(before)).toHaveLength(3);

    // Sixty "token frames".
    for (let i = 0; i < 60; i += 1) fireEvent.click(screen.getByTestId('tick'));

    expect(counts).toEqual(before);
  });

  it('switching tabs re-renders only the two panels whose `active` flipped', () => {
    const { counts, tabs } = makeCountingTabs();
    render(<Host tabs={tabs} />);
    fireEvent.click(screen.getByTestId('right-pane-add-tab'));
    fireEvent.click(screen.getByTestId('right-pane-add-terminal'));
    fireEvent.click(screen.getByTestId('right-pane-add-tab'));
    fireEvent.click(screen.getByTestId('right-pane-add-terminal'));
    const termIds = Object.keys(counts).filter((k) => k !== 'changes');
    const before = { ...counts };

    // The newest terminal is active; select Changes.
    fireEvent.click(screen.getByTestId('right-pane-tab-changes'));

    expect(counts['changes']).toBe(before['changes']! + 1);
    const activeTerm = termIds[1]!;
    const idleTerm = termIds[0]!;
    expect(counts[activeTerm]).toBe(before[activeTerm]! + 1);
    expect(counts[idleTerm]).toBe(before[idleTerm]);
  });

  it('a Component def receives exactly the panel ctx and is rendered inside the tabpanel', () => {
    const seen: RightPanePanelProps[] = [];
    const Probe = React.memo(function Probe(props: RightPanePanelProps) {
      seen.push(props);
      return <div>probe</div>;
    });
    const tabs: Record<string, RightPaneTabDef> = {
      changes: { label: 'Changes', icon: <span />, Component: Probe },
    };
    render(<Host tabs={tabs} />);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ id: 'changes-1', type: 'changes', index: 1, active: true });
    expect(screen.getByTestId('right-pane-panel-changes').textContent).toBe('probe');
  });

  it('legacy render() defs still work (behind the same host)', () => {
    const tabs: Record<string, RightPaneTabDef> = {
      changes: { label: 'Changes', icon: <span />, render: (ctx) => <div>legacy {ctx.id}</div> },
    };
    render(<Host tabs={tabs} />);
    expect(screen.getByTestId('right-pane-panel-changes').textContent).toBe('legacy changes-1');
  });
});

describe('RightPane — narrow viewport becomes a full-width sheet', () => {
  const realMatchMedia = window.matchMedia;
  let listeners: Array<() => void> = [];
  let narrow = false;

  function installMatchMedia() {
    listeners = [];
    // The stub only implements the handful of MediaQueryList members
    // useMediaQuery actually calls, not the full DOM interface — cast
    // through `unknown` (same as the rest of the codebase's matchMedia
    // stubs) rather than widening the stub's shape just to satisfy `tsc`.
    window.matchMedia = ((query: string) => ({
      get matches() {
        return query === NARROW_VIEWPORT_QUERY ? narrow : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: () => void) => { listeners.push(cb); },
      removeEventListener: (_: string, cb: () => void) => { listeners = listeners.filter((l) => l !== cb); },
      addListener: (cb: () => void) => { listeners.push(cb); },
      removeListener: (cb: () => void) => { listeners = listeners.filter((l) => l !== cb); },
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  beforeEach(() => {
    narrow = false;
    installMatchMedia();
  });
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('on desktop: side column with a resize handle and a fullscreen toggle', () => {
    const { tabs } = makeCountingTabs();
    render(<Host tabs={tabs} />);
    const pane = screen.getByTestId('right-pane');
    expect(pane.dataset['fullscreen']).toBeUndefined();
    expect(pane.style.width).toMatch(/px$/);
    expect(screen.getByLabelText('Resize right pane')).toBeTruthy();
    expect(screen.getByTestId('right-pane-fullscreen')).toBeTruthy();
  });

  it('below md: overlays the content, no resize handle, no fullscreen toggle, Escape closes', () => {
    narrow = true;
    const { tabs } = makeCountingTabs();
    const onOpenChange = vi.fn();
    render(<Host tabs={tabs} onOpenChange={onOpenChange} />);
    const pane = screen.getByTestId('right-pane');
    expect(pane.dataset['fullscreen']).toBe('true');
    expect(pane.dataset['narrow']).toBe('true');
    expect(pane.style.width).toBe('');
    expect(pane.className).toContain('inset-0');
    expect(screen.queryByLabelText('Resize right pane')).toBeNull();
    expect(screen.queryByTestId('right-pane-fullscreen')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('follows the viewport live when it crosses the breakpoint', () => {
    const { tabs } = makeCountingTabs();
    render(<Host tabs={tabs} />);
    expect(screen.getByTestId('right-pane').dataset['fullscreen']).toBeUndefined();
    narrow = true;
    act(() => { for (const l of listeners) l(); });
    expect(screen.getByTestId('right-pane').dataset['fullscreen']).toBe('true');
    narrow = false;
    act(() => { for (const l of listeners) l(); });
    expect(screen.getByTestId('right-pane').dataset['fullscreen']).toBeUndefined();
    expect(screen.getByLabelText('Resize right pane')).toBeTruthy();
  });
});

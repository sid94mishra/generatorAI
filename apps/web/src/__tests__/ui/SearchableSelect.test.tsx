// ────────────────────────────────────────────────────────────────
// SearchableSelect — combobox contract.
//
// The trigger must be a real combobox (name, haspopup, controls) and the
// list must be keyboard-filterable and keyboard-selectable.
// ────────────────────────────────────────────────────────────────

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll } from 'vitest';

import { SearchableSelect } from '@/components/ui/SearchableSelect.js';

beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto['scrollIntoView'] !== 'function') proto['scrollIntoView'] = () => {};
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

const ITEMS = [
  { id: 'p1', name: 'Alpha project' },
  { id: 'p2', name: 'Beta project' },
  { id: 'p3', name: 'Gamma project' },
];

describe('SearchableSelect', () => {
  it('exposes a named combobox trigger wired to its listbox', async () => {
    render(
      <SearchableSelect
        aria-label="Project"
        items={ITEMS}
        value={null}
        onSelect={() => {}}
        getKey={(i) => i.id}
        getLabel={(i) => i.name}
        placeholder="Pick a project"
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Project' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Pick a project');

    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
      fireEvent.click(trigger);
    });
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
    const controls = trigger.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('filters by typing and selects with Enter', async () => {
    const onSelect = vi.fn();
    render(
      <SearchableSelect
        aria-label="Project"
        items={ITEMS}
        value={null}
        onSelect={onSelect}
        getKey={(i) => i.id}
        getLabel={(i) => i.name}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Project' });
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
      fireEvent.click(trigger);
    });
    const search = await screen.findByPlaceholderText('Search…');
    await act(async () => {
      fireEvent.change(search, { target: { value: 'gam' } });
    });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option')).toHaveTextContent('Gamma project');

    await act(async () => {
      fireEvent.keyDown(search, { key: 'Enter' });
    });
    expect(onSelect).toHaveBeenCalledWith('p3', ITEMS[2]);
  });

  it('associates with a visible <label htmlFor>', () => {
    render(
      <>
        <label htmlFor="proj">Project picker</label>
        <SearchableSelect
          id="proj"
          items={ITEMS}
          value="p2"
          onSelect={() => {}}
          getKey={(i) => i.id}
          getLabel={(i) => i.name}
        />
      </>,
    );
    expect(screen.getByRole('combobox', { name: 'Project picker' })).toHaveTextContent('Beta project');
  });
});

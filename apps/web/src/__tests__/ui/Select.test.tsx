// ────────────────────────────────────────────────────────────────
// Select — accessible dropdown (plan item 27).
//
// The hand-rolled Select this replaced announced nothing to a screen
// reader while arrowing through options. These tests pin the ARIA
// contract and keyboard behaviour that @radix-ui/react-select gives us,
// through the SAME `Select` API the ~25 call sites use.
// ────────────────────────────────────────────────────────────────

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { useState } from 'react';

import { Select, type SelectOption } from '@/components/ui/Select.js';

// Radix Select touches a few DOM APIs happy-dom does not implement.
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto['hasPointerCapture'] !== 'function') {
    proto['hasPointerCapture'] = () => false;
    proto['setPointerCapture'] = () => {};
    proto['releasePointerCapture'] = () => {};
  }
  if (typeof proto['scrollIntoView'] !== 'function') proto['scrollIntoView'] = () => {};
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

const OPTIONS: SelectOption[] = [
  { value: 'a', label: 'Alpha', description: 'first' },
  { value: 'b', label: 'Beta' },
  { value: '', label: 'None' },
];

function Harness({ initial = 'a', onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <Select
      aria-label="Letter"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      options={OPTIONS}
      placeholder="Pick one"
    />
  );
}

async function open(trigger: HTMLElement) {
  await act(async () => {
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  });
  return screen.getByRole('listbox');
}

describe('Select (Radix-backed)', () => {
  it('renders a combobox trigger carrying the accessible name and the selected label', () => {
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: 'Letter' });
    expect(trigger).toHaveTextContent('Alpha');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a listbox with option roles and aria-selected on the current value', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('combobox', { name: 'Letter' });
    const listbox = await open(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Alphafirst', 'Beta', 'None']);
    expect(screen.getByRole('option', { name: /Alpha/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'false');
    expect(listbox).toBeInTheDocument();
  });

  it('is keyboard operable: ArrowDown moves focus, Enter selects, focus returns to the trigger', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Letter' });
    await open(trigger);

    // Radix moves DOM focus to the highlighted option, which is what makes
    // the choice audible to a screen reader.
    const beta = screen.getByRole('option', { name: 'Beta' });
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? beta, { key: 'ArrowDown' });
    });
    // Radix defers the focus move by a tick.
    await waitFor(() => expect(document.activeElement).toBe(beta));

    await act(async () => {
      fireEvent.keyDown(beta, { key: 'Enter' });
    });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent('Beta');
    // FocusScope hands focus back after the content unmounts.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes on Escape without changing the value', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Letter' });
    await open(trigger);
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? trigger, { key: 'Escape' });
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('round-trips the empty-string option that several call sites use for "none"', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Letter' });
    await open(trigger);
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('option', { name: 'None' }), { key: 'Enter' });
    });
    expect(onChange).toHaveBeenCalledWith('');
    expect(trigger).toHaveTextContent('None');
  });

  it('shows the placeholder when the value matches no option', () => {
    render(<Harness initial="zzz" />);
    expect(screen.getByRole('combobox', { name: 'Letter' })).toHaveTextContent('Pick one');
  });

  it('honours disabled and id (for <label htmlFor>)', () => {
    render(
      <>
        <label htmlFor="letter">Letter field</label>
        <Select id="letter" value="a" onChange={() => {}} options={OPTIONS} disabled />
      </>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Letter field' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('id', 'letter');
  });
});

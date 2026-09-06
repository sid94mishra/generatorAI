// ────────────────────────────────────────────────────────────────
// Drawer — the modal contract the hand-rolled mobile sidebar lacked:
// page content inert while open, Escape closes, focus trapped inside and
// returned to the opener afterwards.
// ────────────────────────────────────────────────────────────────

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeAll } from 'vitest';
import { useState } from 'react';

import { Drawer } from '@/components/ui/Drawer.js';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <main data-testid="page">
        <button type="button" onClick={() => setOpen(true)}>
          Open menu
        </button>
        <a href="#x">Page link</a>
      </main>
      <Drawer open={open} onClose={() => setOpen(false)} title="Navigation" hideTitle hideClose>
        <nav>
          <a href="#a">First</a>
          <a href="#b">Second</a>
        </nav>
      </Drawer>
    </div>
  );
}

describe('Drawer', () => {
  it('renders nothing while closed and a named dialog while open', async () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    });
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
  });

  it('makes the page behind it inert while open', async () => {
    render(<Harness />);
    const page = screen.getByTestId('page');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    });
    // Radix hides every sibling of the portal from assistive tech.
    await waitFor(() => expect(page.closest('[aria-hidden="true"]')).not.toBeNull());
    // …and focus has moved into the drawer, not left on the page.
    await waitFor(() =>
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true),
    );
  });

  it('closes on Escape and returns focus to the opener', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open menu' });
    opener.focus();
    await act(async () => {
      fireEvent.click(opener);
    });
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(screen.getByTestId('page').closest('[aria-hidden="true"]')).toBeNull();
  });
});

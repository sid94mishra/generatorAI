// ────────────────────────────────────────────────────────────────
// FloatingCard — the review composer's anchored card. Replaced a
// hand-rolled `fixed inset-0` catcher with the shared Popover primitive;
// these pin the dismissal contract the old code promised.
// ────────────────────────────────────────────────────────────────

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll } from 'vitest';

import { FloatingCard } from '@/components/diff/review/FloatingCard.js';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

describe('FloatingCard', () => {
  it('renders nothing without an anchor', () => {
    render(
      <FloatingCard anchor={null} onDismiss={() => {}} label="Add review comment">
        <textarea aria-label="Comment" />
      </FloatingCard>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a labelled, non-modal dialog anchored at the pointer and focuses into it', async () => {
    render(
      <>
        <button type="button">Page button</button>
        <FloatingCard anchor={{ x: 120, y: 80 }} onDismiss={() => {}} label="Add review comment">
          <textarea aria-label="Comment" />
        </FloatingCard>
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add review comment' });
    expect(dialog).toBeInTheDocument();
    const anchor = document.querySelector('[data-floating-card-anchor]') as HTMLElement;
    expect(anchor.style.left).toBe('120px');
    expect(anchor.style.top).toBe('80px');
    // Non-modal: nothing on the page is aria-hidden.
    expect(screen.getByRole('button', { name: 'Page button' })).toBeVisible();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('dismisses on Escape — even while typing in its textarea', async () => {
    const onDismiss = vi.fn();
    render(
      <FloatingCard anchor={{ x: 10, y: 10 }} onDismiss={onDismiss} label="Add review comment">
        <textarea aria-label="Comment" />
      </FloatingCard>,
    );
    const textarea = screen.getByRole('textbox', { name: 'Comment' });
    textarea.focus();
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Escape' });
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a pointer-down outside, but not inside', async () => {
    const onDismiss = vi.fn();
    render(
      <>
        <div data-testid="outside">outside</div>
        <FloatingCard anchor={{ x: 10, y: 10 }} onDismiss={onDismiss} label="Add review comment">
          <textarea aria-label="Comment" />
        </FloatingCard>
      </>,
    );
    // Radix arms its outside-pointer listener a tick after mount so the
    // opening click cannot dismiss the card it just opened.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // The migrated Popover-based dismissal defers pointerdown-outside
    // handling to the following `click` event (DismissableLayer is given
    // `deferPointerDownOutside: true` for Popover.Content — see
    // @radix-ui/react-dismissable-layer), so it can tell a genuine outside
    // click apart from the start of a text-selection drag that ends back
    // inside the popover. A bare `pointerDown` (what the old hand-rolled
    // catcher reacted to) is therefore no longer enough to observe
    // dismissal; firing the `click` that always follows it in a real
    // pointer interaction is required, matching real user input.
    await act(async () => {
      fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Comment' }));
      fireEvent.click(screen.getByRole('textbox', { name: 'Comment' }));
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.pointerDown(screen.getByTestId('outside'));
      fireEvent.click(screen.getByTestId('outside'));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

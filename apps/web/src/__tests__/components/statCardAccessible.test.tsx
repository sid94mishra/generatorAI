// ────────────────────────────────────────────────────────────────
// A clickable stat card must be a real button.
//
// Found during the end-to-end browser pass. `Card` renders a plain <div>, and
// `StatCard` / `HealthStatCard` passed `onClick` to it without any button
// semantics — no `role`, no `tabIndex`, no key handler. The Dashboard's
// Chats / Workflows / Automations / Health cards are the primary navigation
// into those lists, so they were reachable by mouse only: invisible to
// assistive tech, unreachable by keyboard, and unfindable by
// `getByRole('button')`.
//
// `EntityCard` already had the correct pattern; these two simply did not use
// it. These tests pin it for both, and pin that a NON-clickable card stays a
// plain div rather than announcing itself as a button.
// ────────────────────────────────────────────────────────────────

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { StatCard } from '@/components/ui/StatCard.js';

describe('StatCard — clickable cards are real buttons', () => {
  it('exposes a button role and is keyboard focusable when clickable', () => {
    render(<StatCard label="Chats" value={12} onClick={() => {}} />);

    const card = screen.getByRole('button', { name: /Chats/i });
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('tabindex', '0');
  });

  it('activates on Enter', async () => {
    const onClick = vi.fn();
    render(<StatCard label="Workflows" value={3} onClick={onClick} />);

    screen.getByRole('button', { name: /Workflows/i }).focus();
    await userEvent.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('activates on Space', async () => {
    const onClick = vi.fn();
    render(<StatCard label="Automations" value={7} onClick={onClick} />);

    screen.getByRole('button', { name: /Automations/i }).focus();
    await userEvent.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('still works with the mouse', async () => {
    const onClick = vi.fn();
    render(<StatCard label="Chats" value={1} onClick={onClick} />);

    await userEvent.click(screen.getByRole('button', { name: /Chats/i }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does NOT announce itself as a button when it is not clickable', () => {
    render(<StatCard label="Read only" value={5} />);

    // A decorative metric is not an interactive control; claiming otherwise
    // is its own accessibility bug.
    expect(screen.queryByRole('button')).toBeNull();
  });
});

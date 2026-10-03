import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { STATUS_STATES } from '@generatorai/shared';
import { initialsOf } from '@/ui/primitives/Avatar/Avatar.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip, ChipList } from '@/ui/primitives/Chip/Chip.js';
import { StatusBadge, statusWord } from '@/ui/primitives/StatusBadge/StatusBadge.js';

describe('initialsOf (P-10)', () => {
  it.each([
    ['Bug Fixer', 'BF'],
    ['orchestrator', 'OR'],
    ['test-writer', 'TW'],
    ['Faux (test)', 'FT'],
    ['(beta)', 'BE'],
    ['  ', '?'],
  ])('%s → %s', (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});

describe('statusWord (P-06)', () => {
  it('uses the shared default word per state', () => {
    expect(statusWord({ state: 'needs_you' })).toBe('Needs you');
    expect(statusWord({ state: 'succeeded' })).toBe('Succeeded');
  });
  it('says Done for chats, keeps an explicit label, appends the phase', () => {
    expect(statusWord({ state: 'succeeded', context: 'chat' })).toBe('Done');
    expect(statusWord({ state: 'skipped', label: 'Cancelled' })).toBe('Cancelled');
    expect(statusWord({ state: 'running', phase: 'Finalizing' })).toBe('Running · Finalizing');
  });
  it('renders glyph + word for every state', () => {
    for (const state of STATUS_STATES) {
      const { container, unmount } = render(<StatusBadge state={state} />);
      expect(container.querySelector('svg[data-icon^="status-"]')).not.toBeNull();
      expect(container.textContent).toBe(statusWord({ state }));
      unmount();
    }
  });
});

describe('Button (P-02)', () => {
  it('ignores clicks while loading and keeps the label for the width', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Commit
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Commit' });
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();
  });
  it('is type=button by default and passes data-testid through', () => {
    render(<Button data-testid="commit-btn">Commit</Button>);
    expect(screen.getByTestId('commit-btn')).toHaveAttribute('type', 'button');
  });
});

describe('Chip (P-09)', () => {
  it('is a span unless interactive', () => {
    const { container } = render(<Chip>backend</Chip>);
    expect(container.firstElementChild?.tagName).toBe('SPAN');
    render(<Chip onClick={() => undefined}>Any</Chip>);
    expect(screen.getByRole('button', { name: 'Any' })).toBeInTheDocument();
  });
  it('ChipList shows +N for the hidden chips', () => {
    render(
      <ChipList max={2}>
        <Chip>a</Chip>
        <Chip>b</Chip>
        <Chip>c</Chip>
        <Chip>d</Chip>
      </ChipList>,
    );
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.queryByText('c')).toBeNull();
  });
});

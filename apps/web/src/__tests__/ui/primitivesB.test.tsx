import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HighlightMatch, matchesQuery } from '@/ui/primitives/Autocomplete/Autocomplete.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { NavItem } from '@/ui/primitives/NavItem/NavItem.js';
import { columnTemplate } from '@/ui/primitives/Table/Table.js';

describe('Autocomplete helpers (P-19)', () => {
  it('matches label and keywords, case-insensitively; empty query matches all', () => {
    const item = { value: 't', label: 'Toggle light / dark', keywords: ['Theme'] };
    expect(matchesQuery(item, 'LIGHT')).toBe(true);
    expect(matchesQuery(item, 'theme')).toBe(true);
    expect(matchesQuery(item, 'zzz')).toBe(false);
    expect(matchesQuery(item, '  ')).toBe(true);
  });
  it('bolds the first match', () => {
    const { container } = render(<HighlightMatch text="Upgrade React Flow" query="flow" />);
    expect(container.querySelector('span')?.textContent).toBe('Flow');
  });
});

describe('Table (P-43)', () => {
  it('turns numbers into px tracks and keeps strings', () => {
    expect(columnTemplate([14, '1fr', 'minmax(200px,1fr)'])).toBe('14px 1fr minmax(200px,1fr)');
  });
});

describe('NavItem (P-27)', () => {
  it('marks the current page', () => {
    render(<NavItem label="Chats" href="#chats" active />);
    expect(screen.getByRole('link', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('EmptyState (P-41)', () => {
  it('announces errors as alerts, empties not', () => {
    const { rerender } = render(<EmptyState icon="warning" title="Failed" tone="error" description="503" />);
    expect(screen.getByRole('alert')).toHaveTextContent('503');
    rerender(<EmptyState icon="chats" title="No chats" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

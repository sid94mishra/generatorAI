// ────────────────────────────────────────────────────────────────
// SearchInput — canonical search field (icon + input + optional clear).
// Replaces the hand-rolled search bars on the 5 list pages.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className, autoFocus }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] py-2 pl-9 pr-9 text-sm text-[var(--color-foreground)]',
          'placeholder:text-[var(--color-muted-foreground)] transition-all duration-150',
          'hover:border-[color-mix(in_srgb,var(--color-primary)_50%,var(--color-border))]',
          'focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none',
        )}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

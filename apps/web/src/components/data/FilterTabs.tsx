// ────────────────────────────────────────────────────────────────
// FilterTabs — segmented pill-group filter for list pages
// (generalized from ChatsListPage's All / Active / Archived).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cn } from '@/lib/utils.js';

export interface FilterTabOption {
  id: string;
  label: string;
  count?: number;
}

export interface FilterTabsProps {
  options: FilterTabOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function FilterTabs({ options, value, onChange, className }: FilterTabsProps) {
  return (
    <div
      role="tablist"
      className={cn('flex rounded-lg border border-border p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-primary-emphasis text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={cn('ml-1.5', active ? 'opacity-80' : 'opacity-60')}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

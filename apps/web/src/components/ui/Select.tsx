// ────────────────────────────────────────────────────────────────
// Select — canonical dropdown primitive (the single source of truth)
// Accessible, themed, portal-rendered, keyboard-navigable.
// Promoted from the former workflow/StyledSelect with token fixes.
// ────────────────────────────────────────────────────────────────

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Optional id for label association */
  id?: string;
  'aria-label'?: string;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  className,
  disabled = false,
  id,
  'aria-label': ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const selected = options.find((o) => o.value === value);

  // Position dropdown based on trigger button
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
      // Radix Dialog (modal) sets `pointer-events: none` on <body>, which a
      // body-portalled dropdown would otherwise inherit — making options
      // unclickable inside modals. Force pointer events back on.
      pointerEvents: 'auto',
    });
  }, [open]);

  // Close on outside click (check both container and portal dropdown)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reset focused index when opening
  useEffect(() => {
    if (open) {
      setFocusedIndex(options.findIndex((o) => o.value === value));
    }
  }, [open, options, value]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === 'Escape') { setOpen(false); return; }
      if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (!open) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, options.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < options.length) {
        e.preventDefault();
        onChange(options[focusedIndex]!.value);
        setOpen(false);
      }
    },
    [open, focusedIndex, options, onChange, disabled],
  );

  return (
    <div ref={containerRef} className={cn('relative', className)} onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between',
          'rounded-md border border-[var(--color-input)]',
          'bg-[var(--color-background)] px-3 py-2',
          'text-sm text-left',
          'transition-all duration-150',
          'hover:border-[color-mix(in_srgb,var(--color-primary)_50%,var(--color-border))]',
          'focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-60',
          open && 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className={cn('truncate', selected ? 'text-[var(--color-foreground)]' : 'text-[var(--color-muted-foreground)]')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]',
            'transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* Dropdown — rendered via portal to escape overflow:hidden containers */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className={cn(
            'rounded-md border border-[var(--color-border)]',
            'bg-[var(--color-popover)] text-[var(--color-popover-foreground)] shadow-lg shadow-black/20',
            'py-1 max-h-56 overflow-y-auto',
            'animate-slide-in-up',
          )}
          style={dropdownStyle}
          role="listbox"
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-sm',
                'transition-colors duration-100',
                option.value === value
                  ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                  : 'text-[var(--color-popover-foreground)] hover:bg-[var(--color-accent)]',
                focusedIndex === index && 'bg-[var(--color-accent)]',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{option.label}</div>
                {option.description && (
                  <div className="truncate text-xs text-[var(--color-muted-foreground)]">{option.description}</div>
                )}
              </div>
              {option.value === value && <Check className="h-4 w-4 shrink-0" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

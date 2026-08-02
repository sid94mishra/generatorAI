// ────────────────────────────────────────────────────────────────
// Input / Textarea — canonical text field primitives
// Consistent border, focus ring, and disabled styling via tokens.
// ────────────────────────────────────────────────────────────────

import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils.js';

const FIELD_BASE = cn(
  'w-full rounded-md border border-input bg-background',
  'text-sm text-foreground placeholder:text-muted-foreground',
  'transition-all duration-150',
  'hover:border-[color-mix(in_srgb,var(--primary)_50%,var(--border))]',
  'focus:border-[var(--primary)] focus:ring-2 focus:ring-primary/20 focus:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-60',
);

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        FIELD_BASE,
        'h-9 px-3',
        invalid && 'border-danger focus:border-danger focus:ring-danger/20',
        className,
      )}
      {...props}
    />
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        FIELD_BASE,
        'px-3 py-2 leading-relaxed resize-y',
        invalid && 'border-danger focus:border-danger focus:ring-danger/20',
        className,
      )}
      {...props}
    />
  );
});

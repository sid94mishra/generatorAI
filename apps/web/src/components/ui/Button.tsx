// ────────────────────────────────────────────────────────────────
// Button — canonical button primitive
// Replaces ad-hoc `.btn-glow` / `.glass-btn` + bespoke className usage.
// Variants map to existing visual language so adoption is visually neutral.
// ────────────────────────────────────────────────────────────────

import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'unstyled';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const VARIANTS: Record<ButtonVariant, string> = {
  // Solid primary action (was `.btn-glow`)
  primary:
    'bg-primary-emphasis text-primary-foreground font-medium hover:opacity-90 active:opacity-80 disabled:opacity-50',
  // Outlined neutral action (was `.glass-btn`)
  secondary:
    'border border-border bg-transparent text-foreground hover:bg-subtle disabled:opacity-50',
  // No chrome until hover
  ghost:
    'bg-transparent text-muted-foreground hover:bg-subtle hover:text-foreground disabled:opacity-50',
  // Destructive
  danger:
    'border border-danger/30 bg-transparent text-danger hover:bg-danger-muted disabled:opacity-50',
  // Filled subtle surface
  subtle:
    'bg-subtle text-foreground hover:bg-emphasis disabled:opacity-50',
  // The shared BEHAVIOUR with none of the look — see `unstyled` below.
  unstyled: '',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 rounded-md px-2.5 text-xs',
  md: 'h-9 gap-2 rounded-md px-3.5 text-sm',
  lg: 'h-11 gap-2 rounded-lg px-5 text-sm',
  icon: 'h-9 w-9 items-center justify-center rounded-md',
  'icon-sm': 'h-7 w-7 items-center justify-center rounded-md',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show a spinner and disable the button */
  loading?: boolean;
  /** Icon rendered before the label */
  leftIcon?: React.ReactNode;
  /** Icon rendered after the label */
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, leftIcon, rightIcon, disabled, className, children, type, ...props },
  ref,
) {
  // `unstyled`: for a control that is a button but does not LOOK like one — a
  // tab pill, a selectable card, a row that is one big click target. It gets
  // what every button must share (the focus ring, the disabled cursor, the
  // loading state, `type="button"`) and nothing that decides layout: no
  // inline-flex, no nowrap, no height, no padding. Forcing a chrome variant
  // onto such controls and undoing it with overrides is what made the Theme
  // cards overflow (nowrap) and squeezed the Discard-plan icon to a dot
  // (padding) — so bespoke controls stayed raw `<button>`s and lost the shared
  // behaviour instead. This is the way to have both.
  const unstyled = variant === 'unstyled';
  return (
    <button
      ref={ref}
      // A bare <button> inside a <form> submits it. Nothing here wants that by accident.
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={cn(
        !unstyled && 'inline-flex items-center whitespace-nowrap font-medium',
        !unstyled && 'transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        !unstyled && 'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        !unstyled && SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className={cn('animate-spin', size === 'sm' || size === 'icon-sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

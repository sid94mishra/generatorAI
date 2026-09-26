// ────────────────────────────────────────────────────────────────
// P-02 Button (03 §2 P-02; Rosetta `.btn`, `.btn-p/-g/-d`, `.btn-sm/-lg`).
//
// Anatomy: optional leading Icon · label · optional trailing Kbd (shortcut) or
// trailing icon (chevron). Heights are density variables (h-control-sm/-/-lg),
// never literals (D-15). One primary per view. `pressed` sets aria-pressed and
// the selected look ("Add codebase", the Windows server chip). `loading` swaps
// the leading icon for the Spinner (or overlays it, keeping the width) and
// makes the button inert without dropping focus.
// `render` replaces the element (router links): `<Button render={<Link to="/x" />}>`.
// ────────────────────────────────────────────────────────────────

import type { MouseEvent, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { focusRing, hitSlop, HIT_ATTRS } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';
import { Kbd } from '../Kbd/Kbd.js';
import { Spinner } from '../Spinner/Spinner.js';

export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 border font-medium whitespace-nowrap select-none',
    'transition-control disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
    // Pressed (aria-pressed="true"): the selected look, kept on hover.
    'aria-pressed:border-transparent aria-pressed:bg-selected aria-pressed:text-fg aria-pressed:hover:not-disabled:bg-selected',
    focusRing,
  ],
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-accent text-on-accent hover:not-disabled:bg-accent/90 disabled:opacity-45',
        secondary: 'border-line bg-raised text-fg hover:not-disabled:bg-hover disabled:text-fg-3',
        ghost: 'border-transparent bg-transparent text-fg-2 hover:not-disabled:bg-hover hover:not-disabled:text-fg disabled:text-fg-3',
        danger: 'border-line bg-raised text-err hover:not-disabled:bg-hover disabled:text-fg-3',
        'danger-ghost': 'border-transparent bg-transparent text-err hover:not-disabled:bg-hover disabled:text-fg-3',
      },
      size: {
        // sm draws 20px at compact density: keep a 24px target (WCAG 2.5.8).
        sm: cn('h-control-sm rounded-control-sm px-2 text-small', hitSlop),
        md: 'h-control rounded-control px-2.5 text-ui',
        lg: 'h-control-lg rounded-control px-3 text-ui',
      },
      fullWidth: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'secondary', size: 'md', fullWidth: false },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps extends useRender.ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading glyph (14 in sm, 16 otherwise). */
  icon?: IconConcept;
  /** Trailing glyph, e.g. `chevron-down` for a menu trigger. */
  trailingIcon?: IconConcept;
  /** Trailing shortcut hint, one chord: `['Ctrl', '↵']`. Rendered on-accent inside primary. */
  shortcut?: readonly string[];
  /** Toggle state: sets `aria-pressed` and the selected look. */
  pressed?: boolean;
  /** Busy: the Spinner replaces the leading icon; clicks are ignored, focus stays. */
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

/**
 * The kit button. Variants primary | secondary (default) | ghost | danger |
 * danger-ghost; sizes sm 24 / md 28 / lg 32 (compact density: −4).
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  trailingIcon,
  shortcut,
  pressed,
  loading = false,
  fullWidth = false,
  render,
  ref,
  className,
  children,
  type,
  onClick,
  ...rest
}: ButtonProps) {
  const glyphSize = size === 'sm' ? 14 : 16;
  const overlaySpinner = loading && !icon;
  const content = (
    <>
      {icon ? loading ? <Spinner size={glyphSize} /> : <Icon concept={icon} size={glyphSize} /> : null}
      {children != null ? (
        <span className={cn('min-w-0 truncate', overlaySpinner && 'opacity-0')}>{children}</span>
      ) : null}
      {trailingIcon ? <Icon concept={trailingIcon} size={12} className="opacity-70" /> : null}
      {shortcut ? <Kbd keys={shortcut} onAccent={variant === 'primary'} aria-hidden /> : null}
      {overlaySpinner ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={glyphSize} />
        </span>
      ) : null}
    </>
  );
  const ownProps = {
    className: cn(buttonVariants({ variant, size, fullWidth }), className),
    // A rendered <a> or router Link is not a submit button.
    ...(render ? {} : { type: type ?? 'button' }),
    ...(size === 'sm' ? HIT_ATTRS : {}),
    ...(pressed !== undefined ? { 'aria-pressed': pressed } : {}),
    ...(loading ? { 'aria-busy': true, 'aria-disabled': true } : {}),
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (loading) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    },
    children: content,
  };
  return useRender({ defaultTagName: 'button', render, ref, props: mergeProps<'button'>(rest, ownProps) });
}

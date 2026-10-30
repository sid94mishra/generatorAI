// ────────────────────────────────────────────────────────────────
// P-09 Chip + ChipList (03 §2 P-09; Rosetta `.chip`, `.chip.mono`, `+3`).
//
// Root is a <span>, or a <button> when interactive (`onClick`, `dropdown`,
// `pressed` or `render`). md 24h / sm 20h (compact: −4 on md); interactive
// chips keep a 24px hit area (`hitSlop`). Variants outline (default) | ghost; `mono` for
// paths and ids. `dropdown` adds the trailing chevron + `aria-haspopup`
// (render it as a Menu or Popover trigger). `onRemove` adds an 18px remove button.
// `pressed` is the toggle chip (SettingsSecurity scopes) with its 12px check box.
// Truncation always shows "+N" (ChipList), never silently.
// ────────────────────────────────────────────────────────────────

import { Children, type ComponentProps, type MouseEvent, type ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { focusRing, hitSlop, HIT_ATTRS } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';

export const chipVariants = cva(
  'inline-flex max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-control border text-small font-medium whitespace-nowrap text-fg-2',
  {
    variants: {
      variant: {
        outline: 'border-line bg-transparent',
        ghost: 'border-transparent bg-transparent',
      },
      size: {
        sm: 'h-badge px-1.5',
        md: 'h-control-sm px-2',
      },
      mono: { true: 'font-mono text-micro font-normal', false: '' },
      interactive: {
        true: cn(
          'cursor-pointer select-none transition-control hover:bg-hover hover:text-fg',
          'aria-pressed:bg-selected aria-pressed:text-fg data-popup-open:bg-selected data-popup-open:text-fg',
          focusRing,
        ),
        false: '',
      },
      removable: { true: 'pr-0.5', false: '' },
    },
    // md draws 20px at compact density and sm is 20 always: keep a 24px target.
    compoundVariants: [{ interactive: true, className: hitSlop }],
    defaultVariants: { variant: 'outline', size: 'md', mono: false, interactive: false, removable: false },
  },
);

export interface ChipProps extends Omit<useRender.ComponentProps<'span'>, 'onClick'> {
  variant?: 'outline' | 'ghost';
  size?: 'sm' | 'md';
  mono?: boolean;
  /** Leading glyph (12 in sm, 14 in md). */
  icon?: IconConcept;
  /** Trailing chevron and `aria-haspopup`; use as a Menu/Select trigger. */
  dropdown?: boolean;
  /** Renders a remove button after the text. */
  onRemove?: () => void;
  /** Accessible name of the remove button. Default `Remove <text>` when the text is a string. */
  removeLabel?: string;
  /** Toggle chip: renders a <button aria-pressed> with a 12px check box. */
  pressed?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}

/** A compact label: filter, tag, path or a small toggle. Interactive when it has a click target. */
export function Chip({
  variant = 'outline',
  size = 'md',
  mono = false,
  icon,
  dropdown = false,
  onRemove,
  removeLabel,
  pressed,
  onClick,
  render,
  ref,
  className,
  children,
  ...rest
}: ChipProps) {
  const interactive = Boolean(onClick || dropdown || pressed !== undefined || render);
  const glyph = size === 'sm' ? 12 : 14;
  const label = (
    <>
      {pressed !== undefined ? <CheckMark checked={pressed} /> : null}
      {icon ? <Icon concept={icon} size={glyph} /> : null}
      <span className="min-w-0 truncate">{children}</span>
      {dropdown ? <Icon concept="chevron-down" size={12} className="text-fg-3" /> : null}
    </>
  );

  const ownProps = {
    className: cn(chipVariants({ variant, size, mono, interactive }), className),
    ...(interactive && !render ? { type: 'button' } : {}),
    ...(interactive ? HIT_ATTRS : {}),
    // A Popover trigger passes its own `aria-haspopup="dialog"`; a menu is the default.
    ...(dropdown ? { 'aria-haspopup': rest['aria-haspopup'] ?? ('menu' as const) } : {}),
    ...(pressed !== undefined ? { 'aria-pressed': pressed } : {}),
    onClick,
    children: label,
  };
  const removable = Boolean(onRemove) && !interactive;
  const element = useRender({
    defaultTagName: interactive ? 'button' : 'span',
    render,
    ref,
    props: mergeProps<'span'>(rest, ownProps),
    enabled: !removable,
  });
  if (element) return element;

  // A removable chip is a group of text + one button (no nested interactive roots).
  const name = removeLabel ?? (typeof children === 'string' ? `Remove ${children}` : 'Remove');
  return (
    <span
      ref={ref as ComponentProps<'span'>['ref']}
      className={cn(chipVariants({ variant, size, mono, removable: true }), className)}
      {...(rest as ComponentProps<'span'>)}
    >
      {label}
      <button
        type="button"
        aria-label={name}
        onClick={onRemove}
        className={cn(
          'inline-flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded-badge text-fg-3',
          'transition-control hover:bg-hover hover:text-fg',
          hitSlop,
          focusRing,
        )}
        {...HIT_ATTRS}
      >
        <Icon concept="x" size={12} />
      </button>
    </span>
  );
}

/** The toggle chip's 12px check box (drawn; the chip button carries aria-pressed). */
function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-3 shrink-0 items-center justify-center rounded-badge border',
        checked ? 'border-accent bg-accent text-on-accent' : 'border-line-strong',
      )}
    >
      {checked ? <Icon concept="check" size={12} /> : null}
    </span>
  );
}

export interface ChipListProps extends ComponentProps<'div'> {
  /** Show at most this many chips; the rest collapse into a "+N" chip. */
  max?: number;
  size?: 'sm' | 'md';
  children?: ReactNode;
}

/** A wrapping row of chips that never truncates silently: overflow becomes "+N". */
export function ChipList({ max, size = 'md', className, children, ...rest }: ChipListProps) {
  const items = Children.toArray(children);
  const shown = max !== undefined && items.length > max ? items.slice(0, max) : items;
  const hidden = items.length - shown.length;
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)} {...rest}>
      {shown}
      {hidden > 0 ? (
        <Chip size={size} className="text-fg-3" title={`${hidden} more`}>
          +{hidden}
        </Chip>
      ) : null}
    </div>
  );
}

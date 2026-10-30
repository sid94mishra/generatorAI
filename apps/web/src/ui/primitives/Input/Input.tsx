// ────────────────────────────────────────────────────────────────
// P-13 Input (03 §2 P-13; Rosetta `.inp`, `.inp.mono`; Base UI Input).
//
// Wrapper → optional leading icon · native <input> · optional trailing slot
// (Kbd, unit, status). md 32h (h-control-lg) / sm 28h; `line-strong` border
// (D-12 overrides the board's `line`: inputs need 3:1), `bg-sunken`, ui text,
// fg-3 placeholder. Focus: `border-focus` + 3px `selected` halo; invalid:
// `border-err` + 3px `err-bg` halo and `aria-invalid`. `mono` for paths and
// crons. `readOnly` is the "generated" look (transparent, fg-2).
// Props not listed below go to the <input> (value, onChange, name …);
// `className` styles the wrapper, `inputClassName` the input.
// ────────────────────────────────────────────────────────────────

import { useRef, type ComponentProps, type PointerEvent, type ReactNode, type Ref } from 'react';
import { cva } from 'class-variance-authority';
import { Input as BaseInput } from '@base-ui/react/input';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { fieldFocus, fieldInvalid } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';

export const inputShellVariants = cva(
  'flex min-w-0 cursor-text items-center gap-2 rounded-control border border-line-strong bg-sunken px-2.5 text-fg transition-control',
  {
    variants: {
      size: { sm: 'h-control', md: 'h-control-lg' },
      state: {
        default: fieldFocus,
        invalid: fieldInvalid,
        readOnly: 'bg-transparent text-fg-2',
        disabled: 'cursor-not-allowed text-fg-3',
      },
    },
    defaultVariants: { size: 'md', state: 'default' },
  },
);

export interface InputProps extends Omit<ComponentProps<'input'>, 'size' | 'ref'> {
  size?: 'sm' | 'md';
  mono?: boolean;
  /** Leading glyph (a concept) or node. */
  leading?: IconConcept | ReactNode;
  /** Trailing node: a Kbd hint, a unit, a status, a clear button. */
  trailing?: ReactNode;
  invalid?: boolean;
  /** Ref to the <input>. */
  ref?: Ref<HTMLInputElement>;
  /** Classes for the <input> itself (`className` is the wrapper). */
  inputClassName?: string;
}

/** A single-line text field. Label it with <label>, `aria-label` or (P5) Field. */
export function Input({
  size = 'md',
  mono = false,
  leading,
  trailing,
  invalid = false,
  className,
  inputClassName,
  ref,
  disabled,
  readOnly,
  ...rest
}: InputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const state = disabled ? 'disabled' : invalid ? 'invalid' : readOnly ? 'readOnly' : 'default';
  // Clicking the padding or the icon focuses the field, as with a native input.
  const focusInput = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target !== inputRef.current && !(event.target as Element).closest('button, a')) {
      event.preventDefault();
      inputRef.current?.focus();
    }
  };
  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
  return (
    <div className={cn(inputShellVariants({ size, state }), className)} onPointerDown={focusInput}>
      {leading ? (
        typeof leading === 'string' ? (
          <Icon concept={leading as IconConcept} size={size === 'sm' ? 14 : 16} className="text-fg-3" />
        ) : (
          leading
        )
      ) : null}
      <BaseInput
        ref={setRefs}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent text-ui text-current outline-none placeholder:text-fg-3 disabled:cursor-not-allowed',
          mono && 'font-mono text-small',
          inputClassName,
        )}
        {...rest}
      />
      {trailing}
    </div>
  );
}

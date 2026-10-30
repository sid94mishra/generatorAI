// ────────────────────────────────────────────────────────────────
// P-16 Field (03 §2 P-16; Rosetta `.lbl` + control + `.hint`).
//
// Vertical (default): label (`text-small` 500 `text-fg-2`, optional
// "(optional)" suffix in `text-fg-3`), the control, then a hint
// (`text-small text-fg-3`); gap 6. An `error` REPLACES the hint: `text-err`,
// a 12px `status-failed` (circle-x) glyph, `role="alert"` (the error only
// appears after interaction, so it is fine to always mark it as one — it is
// absent from the DOM until then).
// Horizontal: a fixed-width label column (pass `labelWidth`, e.g. 64 in
// NewChat, 100 in inspectors, 108 in key-value forms) beside the control.
// Any Base UI input component (Input, Select, Switch, Checkbox, RadioGroup …)
// wired as `children` picks up the field's disabled/invalid state and the
// label's `htmlFor` automatically — no `Field.Control` wrapper needed
// (Base UI docs: "you can omit this part and use any Base UI input
// component instead").
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { Field as BaseField } from '@base-ui/react/field';
import { Fieldset as BaseFieldset } from '@base-ui/react/fieldset';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';

export interface FieldProps extends Omit<ComponentProps<typeof BaseField.Root>, 'className'> {
  label: ReactNode;
  /** Hint under the control (`text-fg-3`); replaced by `error` when present. */
  hint?: ReactNode;
  /** Error message; replaces `hint`, shown in `text-err` with a glyph. */
  error?: ReactNode;
  /** Shows a muted "(optional)" suffix after the label. */
  optional?: boolean;
  orientation?: 'vertical' | 'horizontal';
  /** Fixed label-column width (px) in `orientation="horizontal"`. */
  labelWidth?: number;
  className?: string;
  children?: ReactNode;
}

/** Label + control + hint/error, wired for accessibility around any kit input. */
export function Field({
  label,
  hint,
  error,
  optional = false,
  orientation = 'vertical',
  labelWidth,
  className,
  children,
  invalid,
  ...rest
}: FieldProps) {
  const horizontal = orientation === 'horizontal';
  return (
    <BaseField.Root
      invalid={invalid ?? Boolean(error)}
      className={cn('flex', horizontal ? 'flex-row items-start gap-3' : 'flex-col gap-1.5', className)}
      {...rest}
    >
      <BaseField.Label
        className={cn('text-small font-medium text-fg-2', horizontal ? 'shrink-0 pt-1.5' : '')}
        style={horizontal && labelWidth != null ? { width: labelWidth } : undefined}
      >
        {label}
        {optional ? <span className="font-normal text-fg-3"> (optional)</span> : null}
      </BaseField.Label>
      <div className={cn('flex flex-col gap-1.5', horizontal && 'min-w-0 flex-1')}>
        {children}
        {error != null ? (
          <BaseField.Error match className="flex items-center gap-1 text-small text-err" role="alert">
            <Icon concept="status-failed" size={12} />
            {error}
          </BaseField.Error>
        ) : hint != null ? (
          <BaseField.Description className="text-small text-fg-3">{hint}</BaseField.Description>
        ) : null}
      </div>
    </BaseField.Root>
  );
}

export interface FieldsetProps extends Omit<ComponentProps<typeof BaseFieldset.Root>, 'className'> {
  legend?: ReactNode;
  className?: string;
}

/** Groups related fields with a legend (`text-title` 600). */
export function Fieldset({ legend, className, children, ...rest }: FieldsetProps) {
  return (
    <BaseFieldset.Root className={cn('flex flex-col gap-3', className)} {...rest}>
      {legend != null ? <BaseFieldset.Legend className="text-title font-semibold text-fg">{legend}</BaseFieldset.Legend> : null}
      {children}
    </BaseFieldset.Root>
  );
}

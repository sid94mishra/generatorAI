// ────────────────────────────────────────────────────────────────
// P-20 NumberField (03 §2 P-20; Rosetta ".inp numeric mono with unit"; Base UI
// NumberField).
//
// P-13 Input chrome (`inputShellVariants`, reused so the two stay in sync):
// mono value, optional unit suffix (`text-micro text-fg-3`) and an optional
// stacked stepper pair (ib-sm chevrons) at the trailing edge. `min`/`max`/
// `step` pass straight to Base UI, which clamps keyboard/button/wheel/scrub
// interaction to them (direct typing can go out of range until blur unless
// `allowOutOfRange` is turned off — kept on so paste-then-fix works).
// Boards: WorkflowBuilder attempts/delays/budgets, AutomationCreate,
// SettingsSecurity retention. Label it with `aria-label` or a wrapping
// SettingRow/Field label (Field is P5-01).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import { cn } from '../../lib/cn.js';
import { focusRing, hitSlop, HIT_ATTRS } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';
import { inputShellVariants } from '../Input/Input.js';

export interface NumberFieldProps
  extends Omit<ComponentProps<typeof BaseNumberField.Root>, 'className' | 'render' | 'children'> {
  size?: 'sm' | 'md';
  /** Unit suffix shown after the value ("s", "%", "MB"). */
  unit?: string;
  /** Show the stacked increment/decrement chevrons. Default true. */
  steppers?: boolean;
  invalid?: boolean;
  /** Accessible name — there is no visible label inside the control. */
  'aria-label'?: string;
  className?: string;
  'data-testid'?: string;
}

// Each chevron fills half the group's height (`flex-1` inside a `h-full`
// column) rather than a literal height class — there is no density step this
// small (D-15 only names the control/row/bar/tab/nav heights).
const stepperButton = cn(
  'flex flex-1 w-4 items-center justify-center rounded-control-sm text-fg-3 hover:not-disabled:bg-hover hover:not-disabled:text-fg disabled:cursor-not-allowed disabled:opacity-45',
  hitSlop,
  focusRing,
);

/** A numeric input with mono digits, an optional unit and optional stepper buttons. */
export function NumberField({
  size = 'md',
  unit,
  steppers = true,
  invalid = false,
  disabled,
  className,
  'aria-label': ariaLabel,
  'data-testid': testId,
  ...rootProps
}: NumberFieldProps) {
  const state = disabled ? 'disabled' : invalid ? 'invalid' : 'default';
  return (
    <BaseNumberField.Root disabled={disabled} className="inline-flex" {...rootProps}>
      <BaseNumberField.Group
        className={cn(inputShellVariants({ size, state }), 'pr-1', className)}
        data-testid={testId}
      >
        <BaseNumberField.Input
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-small text-current outline-none placeholder:text-fg-3 disabled:cursor-not-allowed"
        />
        {unit ? <span className="shrink-0 text-micro text-fg-3">{unit}</span> : null}
        {steppers ? (
          <div className="flex h-full shrink-0 flex-col">
            <BaseNumberField.Increment aria-label="Increase" className={stepperButton} {...HIT_ATTRS}>
              <Icon concept="chevron-up" size={12} />
            </BaseNumberField.Increment>
            <BaseNumberField.Decrement aria-label="Decrease" className={stepperButton} {...HIT_ATTRS}>
              <Icon concept="chevron-down" size={12} />
            </BaseNumberField.Decrement>
          </div>
        ) : null}
      </BaseNumberField.Group>
    </BaseNumberField.Root>
  );
}

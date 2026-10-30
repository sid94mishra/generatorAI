// ────────────────────────────────────────────────────────────────
// C-17 Stepper (03-component-inventory-kit.md §… C-17; vertical step nav).
//
// 220 wide, pad 20 12, border-r line-soft, gap 2; step: pad 8, rounded-control,
// gap 10: marker 20 circle (done = check icon; current = `bg-accent
// text-on-accent` mono 11; future = 1px `border-line-strong text-fg-3`),
// title `text-ui` 500 (`text-fg-2` future), subtitle `text-small text-fg-3`
// truncated (errors in `text-err`); current step `bg-selected` +
// `aria-current="step"`; bottom note separated by border-t.
// Consumer: L-02 Wizard (AutomationCreate).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';
import { Button } from '../../primitives/Button/Button.js';

export type StepState = 'done' | 'current' | 'future';

export interface StepperStep {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  state: StepState;
  /** Colours the subtitle `text-err` (a step with a validation problem). */
  error?: boolean;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  /** The current step's id (drives `aria-current` independent of a step's own `state`). */
  current: string;
  onSelect: (id: string) => void;
  /** A note under the last step, separated by a border. */
  footer?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

function StepMarker({ index, state }: { index: number; state: StepState }) {
  if (state === 'done') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
        <Icon concept="check" size={12} />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-micro text-on-accent">
        {index + 1}
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-micro text-fg-3">
      {index + 1}
    </span>
  );
}

/** A vertical step nav for a multi-step wizard (L-02): marker, title, subtitle, click-to-jump. */
export function Stepper({ steps, current, onSelect, footer, className, 'data-testid': testId }: StepperProps) {
  return (
    <nav
      aria-label="Steps"
      className={cn('flex w-55 shrink-0 flex-col gap-0.5 border-r border-line-soft py-5 pr-3 pl-2', className)}
      data-testid={testId}
    >
      {steps.map((step, index) => {
        const isCurrent = step.id === current;
        return (
          <Button
            key={step.id}
            variant="ghost"
            aria-current={isCurrent ? 'step' : undefined}
            onClick={() => onSelect(step.id)}
            className={cn(
              'h-auto items-start justify-start gap-2.5 rounded-control p-2 text-left whitespace-normal',
              isCurrent && 'bg-selected hover:not-disabled:bg-selected',
            )}
          >
            {/* Button wraps its children in one span: lay marker + text out as a row (spec: gap 10). */}
            <span className="flex min-w-0 items-start gap-2.5">
              <StepMarker index={index} state={step.state} />
              <span className="flex min-w-0 flex-col">
                <span className={cn('truncate text-ui font-medium', step.state === 'future' ? 'text-fg-2' : 'text-fg')}>
                  {step.title}
                </span>
                {step.subtitle != null ? (
                  <span className={cn('truncate text-small', step.error ? 'text-err' : 'text-fg-3')}>{step.subtitle}</span>
                ) : null}
              </span>
            </span>
          </Button>
        );
      })}
      {footer != null ? <div className="mt-3 border-t border-line-soft pt-3 text-small text-fg-3">{footer}</div> : null}
    </nav>
  );
}

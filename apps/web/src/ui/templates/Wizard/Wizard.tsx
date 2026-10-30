// ────────────────────────────────────────────────────────────────
// L-02 Wizard (03-component-inventory-kit.md §… L-02): slots only, no logic
// (same discipline as T-01/T-02/T-03/T-04) — AutomationCreate.
//
//   header   C-01 PageHeader (breadcrumb + Draft badge + "Draft saved" + Cancel)
//   stepper  C-17 Stepper, 220 wide
//   content  the current step's section — scrolls, pad 28 40, `max-width 640 gap 22`
//   actions  C-16 ActionBar (Back · next hint · Save draft · Continue)
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface WizardProps {
  header: ReactNode;
  stepper: ReactNode;
  content: ReactNode;
  actions: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** Page layout for a stepped create/edit flow: a side Stepper beside the current step's form. */
export function Wizard({ header, stepper, content, actions, className, 'data-testid': testId }: WizardProps) {
  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-surface text-fg', className)} data-testid={testId}>
      {header}
      <div className="flex min-h-0 flex-1">
        {stepper}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-160 flex-col gap-5.5 px-10 py-7">{content}</div>
        </div>
      </div>
      {actions}
    </div>
  );
}

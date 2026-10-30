// ────────────────────────────────────────────────────────────────
// L-05 ModalWithAside (03 §5 L-05; board WorkflowRunDialog): the body of a
// large Dialog (`size="xl"`, 1040×856) split into a scrolling form column
// and a 360 aside (`w-side-rail`) on a sunken background, each scrolling on
// its own. Slots only, no logic; the Dialog's header and DialogFooter sit
// around it. Below ~900px of dialog width the caller passes `asideStacked`
// and the aside moves under the form (one scroll).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface ModalWithAsideProps {
  main: ReactNode;
  aside: ReactNode;
  /** Accessible name of the aside region ("Plan preview"). */
  asideLabel: string;
  /** Stack the aside under the form (narrow windows). */
  asideStacked?: boolean;
  className?: string;
}

/** Form column beside a 360 aside, inside a Dialog. */
export function ModalWithAside({ main, aside, asideLabel, asideStacked = false, className }: ModalWithAsideProps) {
  if (asideStacked) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5', className)}>
        {main}
        <aside aria-label={asideLabel} className="rounded-card border border-line-soft bg-sunken p-4">
          {aside}
        </aside>
      </div>
    );
  }
  return (
    <div className={cn('flex min-h-0 flex-1', className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-5">{main}</div>
      <aside aria-label={asideLabel} className="w-side-rail shrink-0 overflow-y-auto border-l border-line-soft bg-sunken p-5">
        {aside}
      </aside>
    </div>
  );
}

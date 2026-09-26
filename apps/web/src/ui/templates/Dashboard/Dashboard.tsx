// ────────────────────────────────────────────────────────────────
// L-01 Dashboard (03 §5 L-01): the Home page layout — slots only, no domain
// logic (same discipline as T-01/T-02/T-04) — Home, DesktopWindows.
//
//   header    a plain title + actions
//   dateLine? mono 12 date ("Thursday, 26 September")
//   greeting  the display title (`text-display` already carries 28/600/-0.02em)
//   composer? the quick-start composer block
//   sections? "Needs you" / "Running" / "Recently finished" — each the
//             caller's own C-12 SectionHeader + a bordered list of C-08
//             ActivityRow, stacked with a 20px gap; a section that has no
//             items renders nothing (D-36)
//   aside?    the right column (300px, `w-75`): StatStrip, a System
//             KeyValueList card, a link card of P-27 NavItems — the caller
//             composes these, this template only reserves the column
//
// Body centred at `max-width 1040` (`w-260`), gap 24. Below ~900px card
// width the caller passes `asideStacked` (same reasoning as T-04 Workspace:
// this template does not watch its own width).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface DashboardProps extends Omit<ComponentProps<'div'>, 'children'> {
  header: ReactNode;
  dateLine?: ReactNode;
  greeting: ReactNode;
  composer?: ReactNode;
  sections?: ReactNode;
  aside?: ReactNode;
  /** Set by the caller under ~900px card width: stacks `aside` under the left column. */
  asideStacked?: boolean;
}

/** Page layout for Home: a greeting + activity sections beside a stats/system column. */
export function Dashboard({ header, dateLine, greeting, composer, sections, aside, asideStacked = false, className, ...rest }: DashboardProps) {
  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-surface text-fg', className)} {...rest}>
      {header}
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className={cn('mx-auto flex w-full max-w-260 gap-6 px-7 py-6', asideStacked ? 'flex-col' : 'flex-row')}>
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <div className="flex flex-col gap-1">
              {dateLine != null ? <div className="font-mono text-small text-fg-3">{dateLine}</div> : null}
              <div className="text-display text-fg">{greeting}</div>
            </div>
            {composer}
            {sections}
          </div>
          {aside != null ? <div className={cn('flex flex-col gap-4', !asideStacked && 'w-75 shrink-0 pt-1.5')}>{aside}</div> : null}
        </div>
      </div>
    </div>
  );
}

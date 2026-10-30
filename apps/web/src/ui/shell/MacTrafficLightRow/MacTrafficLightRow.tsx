// ────────────────────────────────────────────────────────────────
// S-07 MacTrafficLightRow (03 §4 S-07, D-23; 06 §3.5, §3.7).
//
// The 44px row at the top of the macOS sidebar (and, in rail mode, of the
// rail): empty, because the OS draws the traffic lights over it
// (`trafficLightPosition` centres them in 44px, from `CHROME.mac`). It is the
// window's drag handle: `data-drag-region="mac"` becomes `app-region: drag`
// only under `.titlebar-inset` (globals.css), so in Storybook or a browser it
// is inert. Its one optional child is the "Restart to update" pill (P3-06),
// right-aligned; interactive children are `no-drag` automatically.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn.js';

export type MacTrafficLightRowProps = ComponentProps<'div'>;

/** The empty 44px drag row the macOS traffic lights sit over. */
export function MacTrafficLightRow({ className, children, ...rest }: MacTrafficLightRowProps) {
  return (
    <div
      data-drag-region="mac"
      className={cn('flex h-bar w-full shrink-0 items-center justify-end pr-1 pl-2', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

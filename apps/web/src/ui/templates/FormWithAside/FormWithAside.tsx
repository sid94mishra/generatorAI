// ────────────────────────────────────────────────────────────────
// T-03 FormWithAside (03 §5 T-03): slots only, no logic — ChatCreate,
// ChatCreateModel, ChatCreateOrchestrator, AgentEditor, CreateProjectPage.
//
//   header    breadcrumb + a route hint
//   form      C-14 FormSection(s), 720px column (`min(720px,100%)`)
//   aside?    C-15 SummaryAside, sticky, 320
//   actions   C-16 ActionBar
//
// Scroll body: centred, gap 48, pad 24 28 0. Below the ~1150px width the
// aside needs, the caller (which owns the container-query breakpoint, same
// reasoning as T-04 Workspace) passes `asideCollapsed`: the aside renders as
// a "Summary" P-45 disclosure above the ActionBar instead of the sticky
// column, and the form column becomes fluid (min 560) with a smaller gap.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Collapsible } from '../../primitives/Collapsible/Collapsible.js';

export interface FormWithAsideProps extends Omit<ComponentProps<'div'>, 'children'> {
  header: ReactNode;
  form: ReactNode;
  aside?: ReactNode;
  actions: ReactNode;
  /** Set by the caller under ~1150px card width: collapses `aside` into a "Summary" disclosure. */
  asideCollapsed?: boolean;
}

/** Page layout for a long create/edit form beside a sticky summary. */
export function FormWithAside({ header, form, aside, actions, asideCollapsed = false, className, ...rest }: FormWithAsideProps) {
  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-surface text-fg', className)} {...rest}>
      {header}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className={cn('flex flex-1 justify-center px-7 pt-6', asideCollapsed ? 'gap-8' : 'gap-12')}>
          <div className={cn('flex w-full flex-col gap-2', asideCollapsed ? 'min-w-140 max-w-180' : 'max-w-180')}>
            {form}
            {asideCollapsed && aside != null ? (
              <Collapsible trigger="Summary" className="mt-2">
                {aside}
              </Collapsible>
            ) : null}
          </div>
          {!asideCollapsed && aside != null ? <div className="w-aside shrink-0">{aside}</div> : null}
        </div>
      </div>
      {actions}
    </div>
  );
}

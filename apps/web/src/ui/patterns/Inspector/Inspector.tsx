// ────────────────────────────────────────────────────────────────
// C-18 Inspector (03 §3 C-18): the 400px (360–440) side panel of
// WorkflowBuilder/Stage*/AgentDraft/ProjectCustomization (PW mostly; the
// redesign's own consumer is ProjectCustomization, P5).
//
// border-l `line-soft`, `bg-surface`: header (`title`, mono `subtitle` — e.g.
// "`key` · Agent stage · 2 of 6" — and ib `actions`) · P-26 Tabs
// `density="panel"` when `tabs` is given · a scrolling body (horizontal P-16
// fields, label 100) · optional sticky `footer`.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Tabs, type TabItem } from '../../primitives/Tabs/Tabs.js';

export interface InspectorTabs {
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
}

export interface InspectorProps {
  title: ReactNode;
  /** The mono id line under the title ("`key` · Agent stage · 2 of 6"). */
  subtitle?: ReactNode;
  tabs?: InspectorTabs;
  /** ib actions, trailing in the header. */
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  /** Panel width in px; default 400 (`w-inspector`), clamp 360–440. */
  width?: number;
  className?: string;
}

/** The 400px side panel: header, optional tabs, a scrolling field body, footer. */
export function Inspector({ title, subtitle, tabs, actions, footer, children, width, className }: InspectorProps) {
  return (
    <div
      className={cn('flex h-full min-h-0 shrink-0 flex-col border-l border-line-soft bg-surface', width == null && 'w-inspector', className)}
      style={width != null ? { width } : undefined}
    >
      <div className="flex h-panel-bar shrink-0 items-center gap-2 border-b border-line-soft pr-2 pl-3.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui font-semibold text-fg">{title}</div>
          {subtitle != null ? <div className="truncate font-mono text-micro text-fg-3">{subtitle}</div> : null}
        </div>
        {actions != null ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {tabs != null ? <Tabs label={typeof title === 'string' ? title : 'Inspector'} density="panel" {...tabs} /> : null}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{children}</div>
      {footer != null ? <div className="shrink-0 border-t border-line-soft p-3">{footer}</div> : null}
    </div>
  );
}

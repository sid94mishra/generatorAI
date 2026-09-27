// ────────────────────────────────────────────────────────────────
// L-04 CanvasEditor (03-kit L-04): the workflow builder layout — slots only,
// no domain logic (same discipline as T-04 Workspace).
//
//   header     C-01 PageHeader (breadcrumb, Published badge, "Unsaved
//              changes", undo/redo/history, Save/Validate/Publish/Run, More,
//              inspector toggle). The route forces the S-03 rail (06 §2.5).
//   banner?    a card over the top of the canvas (the agent-draft banner)
//   canvas     the canvas surface: `bg-sunken`; the canvas brings its own dot
//              grid, floating toolbars, zoom controls and minimap
//   problems?  the problems panel, docked under the canvas (WorkflowValidate)
//   inspector? the C-18 Inspector (400) beside the canvas; absent = hidden
//
// The canvas section is `relative` so a canvas can float panels over it,
// and every slot keeps its subtree across renders (nothing is conditionally
// re-parented), so a React Flow instance is never remounted by toggling the
// inspector or the problems panel.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface CanvasEditorProps extends Omit<ComponentProps<'div'>, 'children'> {
  header: ReactNode;
  canvas: ReactNode;
  /** A card over the top of the canvas (e.g. an agent-draft banner). */
  banner?: ReactNode;
  /** A panel docked under the canvas (validation problems). */
  problems?: ReactNode;
  /** The side inspector (C-18). Omit to hide it. */
  inspector?: ReactNode;
}

/** Page layout for a canvas editor: header, canvas with optional banner/problems, optional inspector. */
export function CanvasEditor({ header, canvas, banner, problems, inspector, className, ...rest }: CanvasEditorProps) {
  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-surface', className)} {...rest}>
      {header}
      <div className="flex min-h-0 flex-1">
        <section aria-label="Canvas" className="relative flex min-w-0 flex-1 flex-col bg-sunken">
          {banner != null ? <div className="absolute inset-x-3 top-14 z-sticky">{banner}</div> : null}
          <div className="relative min-h-0 flex-1">{canvas}</div>
          {problems != null ? <div className="max-h-80 shrink-0 overflow-y-auto border-t border-line-soft bg-surface">{problems}</div> : null}
        </section>
        {inspector}
      </div>
    </div>
  );
}

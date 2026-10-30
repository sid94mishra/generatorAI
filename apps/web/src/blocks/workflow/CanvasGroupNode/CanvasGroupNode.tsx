// ────────────────────────────────────────────────────────────────
// WF-15 CanvasGroupNode — the frame of a container stage (loop, map) on the
// workflow canvas (03-domain §WF-15; board WorkflowLoopBuilder).
//
// Header 44h: kind glyph, name (600) over its mono key, header extras (issue
// markers, draft tags), the kind badge ("Loop · max 5") and the actions slot,
// on a dashed rule. The body slot fills the middle (the canvas draws the body
// stages over it as child nodes; the slot holds overlays such as the "next
// iteration" hint). Footer 28h, micro fg-3: the container's rules and budget
// ("until verdict == 'approve' · stall no_changes ×2 · 250 turns · $12").
// Presentational only: plain props, no store and no canvas library.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';

/** Header band height in px (h-bar): the body slot starts below it. */
export const GROUP_NODE_HEADER_HEIGHT = 44;
/** Footer line height in px (h-step at comfortable density; 24 when compact). */
export const GROUP_NODE_FOOTER_HEIGHT = 28;

export interface CanvasGroupNodeProps extends Omit<ComponentProps<'div'>, 'title'> {
  kind: 'loop' | 'map';
  name: string;
  stageKey: string;
  /** Kind badge text ("Loop · max") … */
  badge: string;
  /** … and its mono value ("5"). */
  badgeValue?: ReactNode;
  selected?: boolean;
  /** Has error-severity issues: err border (unless selected). */
  invalid?: boolean;
  /** Issue markers, draft tags: shown before the kind badge. */
  headerExtras?: ReactNode;
  /** Header actions (the "…" menu). */
  actions?: ReactNode;
  /** The rules/budget line. */
  footer?: ReactNode;
  /** Body slot (overlays drawn inside the body area). */
  children?: ReactNode;
  /** Elements positioned against the whole frame (a canvas's connection handles). */
  frameOverlay?: ReactNode;
}

/** The frame of a loop or map stage on the canvas. */
export function CanvasGroupNode({
  kind,
  name,
  stageKey,
  badge,
  badgeValue,
  selected = false,
  invalid = false,
  headerExtras,
  actions,
  footer,
  children,
  frameOverlay,
  className,
  ...rest
}: CanvasGroupNodeProps) {
  return (
    <div
      role="group"
      aria-label={`${kind === 'map' ? 'Map' : 'Loop'}: ${name}`}
      className={cn(
        'relative flex h-full w-full flex-col rounded-card border bg-sunken text-ui text-fg transition-control',
        selected ? 'border-fg ring-3 ring-selected' : invalid ? 'border-err' : 'border-dashed border-line-strong',
        className,
      )}
      {...rest}
    >
      {frameOverlay}
      <div className="flex h-bar shrink-0 items-center gap-2 border-b border-dashed border-line pr-1 pl-3">
        <Icon concept={kind === 'map' ? 'layers' : 'repeat'} size={14} className="text-fg-3" />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-semibold">{name}</span>
          <span className="truncate font-mono text-micro text-fg-3">{stageKey}</span>
        </div>
        {headerExtras}
        <Badge suffix={badgeValue}>{badge}</Badge>
        {actions}
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
      {footer != null ? (
        <div className="flex h-step shrink-0 items-center gap-1.5 overflow-hidden px-3 text-micro whitespace-nowrap text-fg-3">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// L-03 Gate (03 §5 L-03, D-32; 04 R-6).
//
// A centred column, gap 16: a 420px card (pad 28, gap 20, `bg-surface`, 1px
// `border-line-soft`, `rounded-dialog`) and an optional 420px note below it
// (`text-small text-fg-3`, lh 1.6). Slot-only.
//   - Inside the shell (404, a route error): `placement="card"` fills the
//     main card, whose surface the Gate card sits on.
//   - Full window (an error in the shell itself; Pairing in P5):
//     `placement="window"` paints `bg-ground` edge to edge.
// Content recipe for errors: icon, title (h1), one sentence, the real error
// (plain `font-mono text-small` until C-23 CodeBlock lands in P4), Retry /
// Go home.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';

export interface GateProps extends Omit<ComponentProps<'div'>, 'title'> {
  placement?: 'card' | 'window';
  icon?: IconConcept;
  /** Tints the icon: `err` for errors. */
  tone?: 'neutral' | 'err';
  title: ReactNode;
  /** One sentence under the title. */
  description?: ReactNode;
  /** The real error text, shown verbatim. */
  detail?: ReactNode;
  /** Buttons, right to left in importance (primary last). */
  actions?: ReactNode;
  /** The 420px note under the card. */
  note?: ReactNode;
}

/** The centred single-card layout (errors, pairing). */
export function Gate({
  placement = 'card',
  icon,
  tone = 'neutral',
  title,
  description,
  detail,
  actions,
  note,
  className,
  children,
  ...rest
}: GateProps) {
  return (
    <div
      className={cn(
        'flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6',
        placement === 'window' ? 'h-dvh bg-ground text-fg' : 'h-full',
        className,
      )}
      {...rest}
    >
      <div className="flex w-full max-w-105 flex-col gap-5 rounded-dialog border border-line-soft bg-surface p-7 text-fg">
        <div className="flex flex-col gap-2">
          {icon ? <Icon concept={icon} size={20} className={tone === 'err' ? 'text-err' : 'text-fg-2'} /> : null}
          <h1 className="text-heading">{title}</h1>
          {description != null ? <p className="text-ui text-fg-2">{description}</p> : null}
        </div>
        {detail != null ? (
          <p className="rounded-control border border-line-soft bg-sunken px-2.5 py-2 font-mono text-small wrap-break-word text-fg-2">
            {detail}
          </p>
        ) : null}
        {children}
        {actions != null ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}
      </div>
      {note != null ? <p className="w-full max-w-105 text-small/relaxed text-fg-3">{note}</p> : null}
    </div>
  );
}

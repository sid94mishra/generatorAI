// ────────────────────────────────────────────────────────────────
// P-11 AgentGlyph (03 §2 P-11; DF-13). The `agents` registry concept (lucide
// `bot`) at 12/14/16, `text-fg-3`, no backing tile — unlike P-10 Avatar,
// which is initials-only and reserved for humans/devices (DF-13: "AgentGlyph
// for agents everywhere; initials only for humans/devices"). Optional
// trailing `name`.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';

export interface AgentGlyphProps extends Omit<ComponentProps<'span'>, 'children'> {
  size?: 12 | 14 | 16;
  /** Agent name; shown after the glyph and used as the accessible label. */
  name?: ReactNode;
  className?: string;
}

/** The bot glyph that stands in for an agent wherever Avatar would show a human's initials. */
export function AgentGlyph({ size = 16, name, className, ...rest }: AgentGlyphProps) {
  if (name == null) {
    return (
      <span className={cn('inline-flex shrink-0 text-fg-3', className)} {...rest}>
        <Icon concept="agents" size={size} label="Agent" />
      </span>
    );
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-fg-3', className)} {...rest}>
      <Icon concept="agents" size={size} />
      <span className="min-w-0 truncate text-fg">{name}</span>
    </span>
  );
}

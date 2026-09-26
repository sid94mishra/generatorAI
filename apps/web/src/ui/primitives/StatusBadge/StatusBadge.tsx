// ────────────────────────────────────────────────────────────────
// P-06 StatusBadge — the D-18 8-state badge (03 §2 P-06, 02 §7.1).
//
// Badge + state glyph (12) + word, always both (never colour alone). Glyph,
// word, tone and spin come from the shared map (`STATUS_STATE_DEFS`,
// packages/shared) so web and mobile cannot drift; the props are the shared
// `StatusBadgeProps` contract (packages/shared/src/ui-contract, M-11).
// Callers map server values first: `resolveStatus('workflowRun', run.status)`.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps } from 'react';
import { STATUS_DOMAIN_LABELS, STATUS_STATE_DEFS, type StatusState, type StatusTone } from '@generatorai/shared';
import type { StatusBadgeProps as StatusBadgeContract } from '@generatorai/shared/ui-contract';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';
import { Badge, type BadgeTone } from '../Badge/Badge.js';

/** Glyph colour per shared tone (02 §7.1 "Colour tokens"). */
export const STATUS_TONE_TEXT: Record<StatusTone, string> = {
  'fg-2': 'text-fg-2',
  'fg-3': 'text-fg-3',
  run: 'text-run',
  ok: 'text-ok',
  warn: 'text-warn',
  err: 'text-err',
};

const BADGE_TONE: Record<(typeof STATUS_STATE_DEFS)[StatusState]['badge'], BadgeTone> = {
  idle: 'neutral',
  run: 'run',
  ok: 'ok',
  warn: 'warn',
  err: 'err',
};

/** The word a badge shows: explicit label, else the context's word, else the state's default. */
export function statusWord({ state, context = 'run', label, phase }: StatusBadgeContract): string {
  const base = label ?? (context === 'chat' ? STATUS_DOMAIN_LABELS.chat?.[state] : undefined) ?? STATUS_STATE_DEFS[state].label;
  return phase ? `${base} · ${phase}` : base;
}

export interface StatusBadgeProps extends StatusBadgeContract, Omit<ComponentProps<'span'>, 'children'> {}

/** Glyph + word for one of the 8 visual states. Running spins (static under reduced motion). */
export function StatusBadge({ state, context, label, phase, className, ...rest }: StatusBadgeProps) {
  const def = STATUS_STATE_DEFS[state];
  return (
    <Badge tone={BADGE_TONE[def.badge]} className={className} data-status={state} {...rest}>
      <Icon
        concept={def.glyph as IconConcept}
        size={12}
        className={cn(STATUS_TONE_TEXT[def.tone], def.spin && 'animate-spin reduced:animate-none')}
      />
      {statusWord({ state, context, label, phase })}
    </Badge>
  );
}

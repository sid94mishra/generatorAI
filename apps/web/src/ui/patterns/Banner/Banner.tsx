// ────────────────────────────────────────────────────────────────
// C-29 Banner (03 §3 C-29): ProjectDetail, ProjectCustomization ("N need
// you").
//
// A single-line tinted strip, 40h, pad 0 8 0 12, gap 10, `rounded-card`, 1px
// `border-line`, `bg-<tone>-bg`: tone icon · bold `lead` (`text-ui` 600) ·
// truncated `detail` (`text-ui text-fg-2`) · spacer · sm `action` (Review).
// Same tone/icon pairing as P-40 Callout.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';

export type BannerTone = 'info' | 'warn' | 'err' | 'ok';

const TONE: Record<BannerTone, { bg: string; icon: IconConcept; text: string }> = {
  info: { bg: 'bg-run-bg', icon: 'info', text: 'text-run' },
  warn: { bg: 'bg-warn-bg', icon: 'warning', text: 'text-warn' },
  err: { bg: 'bg-err-bg', icon: 'status-failed', text: 'text-err' },
  ok: { bg: 'bg-ok-bg', icon: 'status-succeeded', text: 'text-ok' },
};

export interface BannerProps {
  tone: BannerTone;
  lead: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** A single-line, tone-tinted approval/status strip. */
export function Banner({ tone, lead, detail, action, className }: BannerProps) {
  const t = TONE[tone];
  return (
    <div className={cn('flex h-panel-bar shrink-0 items-center gap-2.5 rounded-card border border-line pr-2 pl-3', t.bg, className)}>
      <Icon concept={t.icon} size={16} className={cn('shrink-0', t.text)} />
      <span className="shrink-0 text-ui font-semibold text-fg">{lead}</span>
      {detail != null ? <span className="min-w-0 flex-1 truncate text-ui text-fg-2">{detail}</span> : <span className="flex-1" />}
      {action}
    </div>
  );
}

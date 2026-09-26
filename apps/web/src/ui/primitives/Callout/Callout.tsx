// ────────────────────────────────────────────────────────────────
// P-40 Callout (03 §2 P-40; Rosetta "pad 10 12, r8, border line, --*-bg
// background").
//
// A bounded inline message: pad 10 12, card radius, a FULL 1px `border-line`
// (never a left stripe), tone background, gap 10. Row: 16px tone icon · body
// (`title` line in `text-ui text-fg`, then `children` in `text-small
// text-fg-2`; without a title the children ARE the ui/fg line) · optional
// trailing action (an sm Button).
// Tones: `info` → the run tokens (`bg-run-bg`, `text-run` icon; there is no
// separate info hue in the D-08 vocabulary, run is the informational blue),
// `warn`, `err`, `ok` → `bg-<tone>-bg` + `text-<tone>` icon; `neutral` →
// `bg-raised border-line-soft`, `text-small text-fg-2` body (Scripts info box).
// Icons (concepts): info `info`, warn `warning`, err `status-failed`
// (circle-x), ok `status-succeeded` (circle-check), neutral `info`;
// `icon` overrides. Not a live region: pass `role="alert"` / `role="status"`
// when the callout appears in response to an action.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';

export const calloutVariants = cva('flex items-start gap-2.5 rounded-card border px-3 py-2.5', {
  variants: {
    tone: {
      info: 'border-line bg-run-bg',
      warn: 'border-line bg-warn-bg',
      err: 'border-line bg-err-bg',
      ok: 'border-line bg-ok-bg',
      neutral: 'border-line-soft bg-raised',
    },
  },
  defaultVariants: { tone: 'info' },
});

export type CalloutTone = NonNullable<VariantProps<typeof calloutVariants>['tone']>;

const TONE_ICON: Record<CalloutTone, { concept: IconConcept; className: string }> = {
  info: { concept: 'info', className: 'text-run' },
  warn: { concept: 'warning', className: 'text-warn' },
  err: { concept: 'status-failed', className: 'text-err' },
  ok: { concept: 'status-succeeded', className: 'text-ok' },
  neutral: { concept: 'info', className: 'text-fg-3' },
};

export interface CalloutProps extends Omit<ComponentProps<'div'>, 'title'> {
  tone?: CalloutTone;
  /** First line (`text-ui text-fg`); `children` then become the `text-small text-fg-2` second line. */
  title?: ReactNode;
  children?: ReactNode;
  /** Trailing control, usually `<Button size="sm">`. */
  action?: ReactNode;
  /** Replaces the tone's default glyph. */
  icon?: IconConcept;
}

/** An inline, bordered message with a tone icon. */
export function Callout({ tone = 'info', title, children, action, icon, className, ...rest }: CalloutProps) {
  const glyph = TONE_ICON[tone];
  const neutral = tone === 'neutral';
  return (
    <div className={cn(calloutVariants({ tone }), className)} {...rest}>
      {/* mt-0.5: centres the 16px glyph on the first ≈ 19px ui line. */}
      <Icon concept={icon ?? glyph.concept} size={16} className={cn('mt-0.5', glyph.className)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title != null ? <div className={neutral ? 'text-small text-fg-2' : 'text-ui text-fg'}>{title}</div> : null}
        {children != null ? (
          <div className={cn(title != null || neutral ? 'text-small text-fg-2' : 'text-ui text-fg')}>{children}</div>
        ) : null}
      </div>
      {action != null ? <div className="flex shrink-0 items-center self-center">{action}</div> : null}
    </div>
  );
}

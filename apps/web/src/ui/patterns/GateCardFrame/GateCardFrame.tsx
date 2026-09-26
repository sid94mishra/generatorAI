// ────────────────────────────────────────────────────────────────
// C-30 GateCardFrame (03 §3 C-30; Rosetta "card r10 with 36h warn-bg header
// and kbd-default buttons"; board ApprovalHeader36). The layout of the
// permission, plan and question cards; their logic stays in features (F-xx).
//
// Card: 1px `line`, `rounded-panel`, `bg-raised`, overflow hidden.
// Header 36h (`h-tab`), pad 0 12, gap 8, tinted by `tone` (`bg-<tone>-bg`,
// default `warn` — a gate waits on the user), bottom `line-soft` rule:
// 16px tone icon · title (ui 600) · meta (small, right, truncated).
// Body pad 12, gap 10: `children`, then the action row — explanation (small
// fg-3, truncated) · spacer · sm Buttons, each with its keyboard default as a
// trailing Kbd (`Esc` / `↵` / `Ctrl ↵`) through Button's own `shortcut`.
// The card is a `group` named by its title.
// ────────────────────────────────────────────────────────────────

import { useId, type ComponentProps, type ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { Icon } from '../../icons/Icon.js';
import { Button, type ButtonVariant } from '../../primitives/Button/Button.js';

export type GateTone = 'warn' | 'err' | 'ok' | 'run';

const HEADER_BG: Record<GateTone, string> = {
  warn: 'bg-warn-bg',
  err: 'bg-err-bg',
  ok: 'bg-ok-bg',
  run: 'bg-run-bg',
};

const ICON_TEXT: Record<GateTone, string> = {
  warn: 'text-warn',
  err: 'text-err',
  ok: 'text-ok',
  run: 'text-run',
};

export interface GateAction {
  label: string;
  variant?: ButtonVariant;
  /** Keyboard default shown as a trailing Kbd (`['Esc']`, `['↵']`, `['Ctrl', '↵']`). */
  shortcut?: readonly string[];
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  'data-testid'?: string;
}

export interface GateCardFrameProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Header tint and icon colour. Default `warn`. */
  tone?: GateTone;
  icon: IconConcept;
  title: ReactNode;
  /** Right side of the header (tool name, path, "Step 3 of 5"). */
  meta?: ReactNode;
  children?: ReactNode;
  /** Left side of the action row: what the primary action will do. */
  explanation?: ReactNode;
  actions: readonly GateAction[];
}

/** The frame of a gate card (approval, plan, question): tinted header, body, keyboard-default actions. */
export function GateCardFrame({
  tone = 'warn',
  icon,
  title,
  meta,
  children,
  explanation,
  actions,
  className,
  ...rest
}: GateCardFrameProps) {
  const titleId = useId();
  const hasActionRow = explanation != null || actions.length > 0;
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={cn('flex flex-col overflow-hidden rounded-panel border border-line bg-raised', className)}
      {...rest}
    >
      <div className={cn('flex h-tab shrink-0 items-center gap-2 border-b border-line-soft px-3', HEADER_BG[tone])}>
        <Icon concept={icon} size={16} className={cn('shrink-0', ICON_TEXT[tone])} />
        <span id={titleId} className="min-w-0 truncate text-ui font-semibold text-fg">
          {title}
        </span>
        {/* Plain fg, not fg-2/fg-3: axe measured fg-2 on err-bg at 4.49:1 in Solarized Light (D-12's
            fg-2/fg-3 clamp only guarantees the 5 neutral surfaces, not a tone-tinted header background). */}
        {meta != null ? <span className="ml-auto min-w-0 truncate text-small text-fg">{meta}</span> : null}
      </div>
      <div className="flex flex-col gap-2.5 p-3">
        {children}
        {hasActionRow ? (
          <div className="flex min-w-0 items-center gap-2">
            {explanation != null ? <span className="min-w-0 flex-1 truncate text-small text-fg-3">{explanation}</span> : null}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {actions.map(({ label, variant = 'secondary', shortcut, onClick, disabled, loading, 'data-testid': testId }) => (
                <Button
                  key={label}
                  size="sm"
                  variant={variant}
                  {...(shortcut ? { shortcut } : {})}
                  onClick={onClick}
                  disabled={disabled}
                  loading={loading}
                  data-testid={testId}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

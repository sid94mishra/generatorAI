// ────────────────────────────────────────────────────────────────
// C-24 TerminalFrame — terminal chrome without xterm (03 §3 C-24; boards
// DockTerminal, ChatTerminal).
//
// Toolbar 40h (`h-panel-bar`), border-b `line-soft`: the caller's `toolbar`
// (instance tabs as sm buttons/chips, cwd, host badge, attach …) then, pushed
// right, a "Clear" ghost sm button (`onClear`) and a "Kill" danger sm button
// tinted `bg-err-bg` (`onKill`). Body: `bg-sunken`, pad 10 12, mono small,
// line-height 18, carrying `data-gai-keys="own"` (D-46: the command host
// leaves every key to the terminal). `find` (C-32 FindWidget) floats top-right
// over the body, outside the key-owning element so the find field keeps the
// normal shortcut rules. `status` is a 28h footer (small fg-3), border-t.
// The xterm host goes in `children`; the frame never knows about xterm.
// `header` is an optional 40h row above the toolbar (the dock panel's cwd /
// host badges / quick-cd row); `killConfirm` wraps the Kill button (the
// ConfirmPopover recipe) instead of `onKill` firing on click.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Button } from '../../primitives/Button/Button.js';

export interface TerminalFrameProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Toolbar content before the Clear / Kill buttons: instance tabs, cwd, status chips. */
  toolbar: ReactNode;
  /** Footer status text (exit code, "Connected · pty · zsh"). No footer when omitted. */
  status?: ReactNode;
  /** The terminal body (the xterm host, an exited notice). */
  children: ReactNode;
  /** C-32 FindWidget, floated top-right over the body. */
  find?: ReactNode;
  /** Renders the "Clear" ghost button. */
  onClear?: () => void;
  /** Renders the "Kill" danger button. */
  onKill?: () => void;
  /** Renders Kill and hands it to this wrapper (a confirm Popover) instead of calling `onKill`. */
  killConfirm?: (killButton: ReactElement) => ReactNode;
  /** A 40h row above the toolbar (cwd, host badge, quick cd). */
  header?: ReactNode;
  /** Kill unavailable (no process). */
  killDisabled?: boolean;
  /** Accessible name of Clear; must contain the visible "Clear". Default "Clear scrollback". */
  clearLabel?: string;
  /** Accessible name of Kill; must contain the visible "Kill". Default "Kill the terminal process". */
  killLabel?: string;
}

/** Terminal chrome: toolbar with Clear / Kill, key-owning body, find overlay, status footer. */
export function TerminalFrame({
  toolbar,
  status,
  children,
  find,
  onClear,
  onKill,
  killConfirm,
  header,
  killDisabled = false,
  clearLabel = 'Clear scrollback',
  killLabel = 'Kill the terminal process',
  className,
  ...rest
}: TerminalFrameProps) {
  const killButton =
    onKill || killConfirm ? (
      <Button
        variant="danger"
        size="sm"
        icon="power"
        aria-label={killLabel}
        disabled={killDisabled}
        {...(killConfirm ? {} : { onClick: onKill })}
        // Spec tint: Kill sits on `bg-err-bg` (Button's danger variant is raised).
        className="bg-err-bg hover:not-disabled:bg-err-bg hover:not-disabled:border-err"
      >
        Kill
      </Button>
    ) : null;
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)} {...rest}>
      {header != null ? (
        <div className="flex h-panel-bar shrink-0 items-center gap-1.5 border-b border-line-soft px-2">{header}</div>
      ) : null}
      <div className="flex h-panel-bar shrink-0 items-center gap-1.5 border-b border-line-soft px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{toolbar}</div>
        {onClear || killButton ? (
          <div className="flex shrink-0 items-center gap-1">
            {onClear ? (
              <Button variant="ghost" size="sm" aria-label={clearLabel} onClick={onClear}>
                Clear
              </Button>
            ) : null}
            {killButton ? (killConfirm ? killConfirm(killButton) : killButton) : null}
          </div>
        ) : null}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sunken px-3 py-2.5 font-mono text-small leading-4.5 text-fg"
          data-gai-keys="own"
        >
          {children}
        </div>
        {find != null ? <div className="absolute top-2 right-2 z-sticky">{find}</div> : null}
      </div>
      {status != null ? (
        <div className="flex h-step shrink-0 items-center gap-2 border-t border-line-soft px-3 text-small text-fg-3">
          {status}
        </div>
      ) : null}
    </div>
  );
}

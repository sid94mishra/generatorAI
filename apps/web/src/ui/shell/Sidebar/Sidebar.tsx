// ────────────────────────────────────────────────────────────────
// S-02 Sidebar (03 §4 S-02, D-22; 06 §2.1, §3.5; boards Main, DesktopMac,
// DesktopWindows).
//
// 232 wide (`w-sidebar`), no border, `bg-ground`, a column with gap 2. Slots
// top to bottom:
//   topRow   S-07 MacTrafficLightRow (macOS) or the Linux native-frame 36px
//            back/forward row (SidebarNavRow; desktop only, never on the web)
//   header   40h row: ServerSwitcher + Collapse (web, macOS, Linux), or the
//            logo + "GeneratorAI" + New chat row (Windows strip layout)
//   actions  SidebarSearchButton + New chat (omitted in the strip layout,
//            whose title strip holds Search)
//   nav      P-27 NavItems from NAV_DESTINATIONS, inside SidebarNav
//   live     SidebarSection "Needs you" / "Running" (only once the attention
//            feed has loaded, D-36)
//   footer   SidebarFooter: connection status + Settings (+ the "Restart to
//            update" pill above it on macOS and the Linux native frame, D-23)
// Padding per layout (boards): web & Linux `10 8 8 8`, macOS `0 8 8 8` (the
// traffic row comes first), Windows `4 8 8 8`. The nav and live lists scroll
// between the fixed header and footer.
// Presentational: app/shell (ConnectedSidebar) supplies every slot.
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { AppMark } from '../../icons/vendor/VendorIcons.js';
import { Icon } from '../../icons/Icon.js';
import { Button } from '../../primitives/Button/Button.js';
import { StatusDot, type DotTone } from '../../primitives/StatusDot/StatusDot.js';
import type { CountTone } from '../../primitives/Count/Count.js';
import { SectionHeader } from '../../patterns/SectionHeader/SectionHeader.js';
import type { ShellLayout } from '../AppFrame/AppFrame.js';

export interface SidebarProps extends Omit<ComponentProps<'aside'>, 'children'> {
  layout: ShellLayout;
  /** MacTrafficLightRow (macOS) or SidebarNavRow (Linux native desktop). */
  topRow?: ReactNode;
  header: ReactNode;
  /** Search + New chat row (omitted in the strip layout: the strip has search). */
  actions?: ReactNode;
  nav: ReactNode;
  /** Needs you / Running sections. */
  live?: ReactNode;
  footer: ReactNode;
}

const PAD_TOP: Record<ShellLayout, string> = { mac: 'pt-0', strip: 'pt-1', native: 'pt-2.5' };

/** The 232px app sidebar. */
export function Sidebar({ layout, topRow, header, actions, nav, live, footer, className, ...rest }: SidebarProps) {
  return (
    <aside
      aria-label="Sidebar"
      data-testid="app-sidebar"
      data-collapsed="full"
      className={cn(
        'flex w-sidebar shrink-0 flex-col gap-0.5 overflow-hidden bg-ground px-2 pb-2 text-fg',
        topRow ? 'pt-0' : PAD_TOP[layout],
        className,
      )}
      {...rest}
    >
      {topRow}
      {header}
      {actions}
      <div className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
        {nav}
        {live}
      </div>
      {footer}
    </aside>
  );
}

/** Linux native frame (desktop only): the 36px Back / Forward row. */
export function SidebarNavRow({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('-mx-1 flex h-strip shrink-0 items-center gap-0.5', className)} {...rest} />;
}

/** The 40h header row (server switcher + collapse, or the Windows logo row). */
export function SidebarHeaderRow({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('flex h-panel-bar shrink-0 items-center gap-2 pr-1 pl-1.5', className)} {...rest} />;
}

/** The logo + product name (Windows strip layout, where servers live in the strip). */
export function SidebarBrand({ className, ...rest }: Omit<ComponentProps<'span'>, 'children'>) {
  return (
    <span className={cn('flex min-w-0 flex-1 items-center gap-2.5 pl-0.5 text-ui font-semibold', className)} {...rest}>
      <AppMark className="size-5.5 shrink-0" />
      <span className="truncate">GeneratorAI</span>
    </span>
  );
}

export interface ServerSwitcherProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** Second line: the active server ("This computer", a remote's name). Omitted until known. */
  server?: ReactNode;
}

/**
 * "GeneratorAI / This computer ⌄": the app identity and the active server, and
 * the trigger of the 280px Servers menu (pass it as `Menu.Trigger`'s
 * `render`; 36h, `rounded-control`, hover and open states in `hover`).
 */
export function ServerSwitcher({ server, className, ...rest }: ServerSwitcherProps) {
  return (
    <Button
      variant="ghost"
      trailingIcon="chevron-down"
      className={cn(
        'h-auto min-h-9 min-w-0 flex-1 justify-start gap-2.5 rounded-control pr-1.5 pl-0.5 font-normal text-fg',
        'hover:not-disabled:text-fg data-popup-open:bg-hover',
        className,
      )}
      {...rest}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <AppMark className="size-5.5 shrink-0" />
        <span className="flex min-w-0 flex-col text-left leading-tight">
          <span className="truncate text-ui font-semibold">GeneratorAI</span>
          {server != null ? <span className="truncate text-micro text-fg-3">{server}</span> : null}
        </span>
      </span>
    </Button>
  );
}

export interface SidebarSearchButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'ref'> {
  /** One chord for the hint, already formatted for this host: `['Ctrl', 'K']`. */
  shortcut?: readonly string[];
}

/** The "Search  Ctrl K" button that opens the command palette (30h, `bg-surface`). */
export function SidebarSearchButton({ shortcut, className, ...rest }: SidebarSearchButtonProps) {
  return (
    <Button
      icon="search"
      shortcut={shortcut}
      className={cn(
        'h-nav min-w-0 flex-1 justify-start border-line-soft bg-surface font-normal text-fg-3 hover:not-disabled:text-fg-2 *:last:ml-auto',
        className,
      )}
      {...rest}
    >
      Search
    </Button>
  );
}

/** The search + New chat row. */
export function SidebarActionsRow({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('flex shrink-0 gap-1.5 pt-1 pb-2', className)} {...rest} />;
}

/** The <nav> holding the destination NavItems. */
export function SidebarNav({ className, ...rest }: ComponentProps<'nav'>) {
  return <nav aria-label="Main" className={cn('flex shrink-0 flex-col gap-px', className)} {...rest} />;
}

export interface SidebarSectionProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: string;
  count?: ReactNode;
  countTone?: CountTone;
  /** Space above: 14 for the first live section, 10 for the next (boards). */
  spacing?: 'first' | 'next';
}

/** A live list ("Needs you 2", "Running 3"): a label header and its rows. */
export function SidebarSection({ title, count, countTone, spacing = 'first', className, children, ...rest }: SidebarSectionProps) {
  return (
    <section
      aria-label={title}
      className={cn('flex shrink-0 flex-col gap-px', spacing === 'first' ? 'mt-3.5' : 'mt-2.5', className)}
      {...rest}
    >
      <SectionHeader variant="label" title={title} count={count} countTone={countTone} />
      {children}
    </section>
  );
}

export interface SidebarFooterProps extends Omit<ComponentProps<'div'>, 'children'> {
  tone: DotTone;
  /** "Connected" / "Reconnecting…" / "Disconnected". */
  label: string;
  /** The server address (mono), e.g. `local:3100`. */
  address?: string;
  /** Extra block above the row: the missing-events notice. */
  notice?: ReactNode;
  /** The "Restart to update" pill (UpdatePill `footer`), above the row; only while an update is ready. */
  update?: ReactNode;
  /** Settings icon button. */
  action?: ReactNode;
}

export interface SidebarFooterNoticeProps extends Omit<ComponentProps<'div'>, 'children'> {
  message: ReactNode;
  /** One small action (Refresh). */
  action?: ReactNode;
}

/** A warn-tinted notice above the footer row (the "events may be missing" callout). */
export function SidebarFooterNotice({ message, action, className, ...rest }: SidebarFooterNoticeProps) {
  return (
    <div
      role="alert"
      className={cn('mt-2 flex flex-col gap-1.5 rounded-card bg-warn-bg px-2.5 py-2 text-small text-warn', className)}
      {...rest}
    >
      <span className="flex items-start gap-1.5">
        <Icon concept="warning" size={14} className="mt-px shrink-0" />
        <span className="min-w-0">{message}</span>
      </span>
      {action != null ? <span className="flex justify-end">{action}</span> : null}
    </div>
  );
}

/** The 44h footer: connection dot · label · address · Settings. */
export function SidebarFooter({ tone, label, address, notice, update, action, className, ...rest }: SidebarFooterProps) {
  return (
    <div className={cn('mt-2 flex shrink-0 flex-col border-t border-line-soft', className)} {...rest}>
      {notice}
      {update != null ? <div className="flex pt-2">{update}</div> : null}
      <div className="flex h-bar items-center gap-2 pt-2 pr-1 pl-2.5">
        <StatusDot tone={tone} size="sm" />
        <span role="status" className="shrink-0 text-small text-fg-2">
          {label}
        </span>
        {address ? <span className="min-w-0 truncate font-mono text-micro text-fg-3">{address}</span> : null}
        {action != null ? <span className="ml-auto flex shrink-0">{action}</span> : null}
      </div>
    </div>
  );
}

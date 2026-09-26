// ────────────────────────────────────────────────────────────────
// ConnectedSidebar — S-02 wired to the router, the stores and the live feeds
// (06 §2.1, §3.5; D-22).
//
// Per layout:
//   mac     S-07 traffic row (drag) → switcher + Collapse → Search + New chat
//   native  (Linux desktop only) 36px Back/Forward row → switcher + Collapse →
//           Search + New chat; plain web has no nav row (the browser has one)
//   strip   logo + "GeneratorAI" + New chat (Search, Back/Forward and the
//           server chip live in the title strip)
// Then the nav (NAV_DESTINATIONS), the live Needs you / Running lists (only
// once the attention feed has loaded, and only when non-empty — D-36), and
// the footer: connection status + Settings, with the "Restart to update" pill
// above it while an update is ready (mac and native layouts; the strip layout
// has it in the title strip, D-23). The server switcher opens the Servers
// menu (P3-06).
// `inFlyout`: the same sidebar opened over a forced rail; Collapse closes it.
// ────────────────────────────────────────────────────────────────

import { Link, useLocation } from 'react-router';
import { NAV_DESTINATIONS, navDestinationFor } from '@generatorai/shared/ui-contract';
import type { AttentionItem } from '@generatorai/shared';
import { isDesktop, type ShellLayout } from '@/lib/desktop.js';
import { useAttention } from '@/hooks/attentionQueries.js';
import { useRefetchAfterGap } from '@/hooks/useConnectionSummary.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Count } from '@/ui/primitives/Count/Count.js';
import { Icon } from '@/ui/icons/Icon.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { NavItem } from '@/ui/primitives/NavItem/NavItem.js';
import { MacTrafficLightRow } from '@/ui/shell/MacTrafficLightRow/MacTrafficLightRow.js';
import {
  ServerSwitcher,
  Sidebar,
  SidebarActionsRow,
  SidebarBrand,
  SidebarFooter,
  SidebarFooterNotice,
  SidebarHeaderRow,
  SidebarNav,
  SidebarNavRow,
  SidebarSearchButton,
  SidebarSection,
} from '@/ui/shell/Sidebar/Sidebar.js';
import { useShellActions } from './shellActions.js';
import { ConnectedUpdatePill } from './ConnectedUpdatePill.js';
import { ServersMenu } from './ServersMenu.js';
import { formatElapsed, useNow } from '@/lib/elapsed.js';
import { useNavHistory } from './useNavHistory.js';
import { shortcutFor, useShellStatus } from '@/hooks/useShellStatus.js';

export interface ConnectedSidebarProps {
  layout: ShellLayout;
  /** Rendered inside the SidebarFlyout over a forced rail. */
  inFlyout?: boolean;
}

export function ConnectedSidebar({ layout, inFlyout = false }: ConnectedSidebarProps) {
  const actions = useShellActions();
  const status = useShellStatus();
  const { pathname } = useLocation();
  const active = navDestinationFor(pathname)?.id;
  const strip = layout === 'strip';

  const topRow =
    layout === 'mac' ? (
      <MacTrafficLightRow data-testid="sidebar-drag-region" aria-hidden />
    ) : layout === 'native' && isDesktop ? (
      <NativeNavRow />
    ) : undefined;

  const collapse = (
    <IconButton
      icon="sidebar"
      label="Hide sidebar"
      data-testid="sidebar-toggle"
      data-sidebar-toggle=""
      shortcut={shortcutFor('sidebar.toggle')}
      onClick={actions.toggleSidebar}
    />
  );
  const newChat = (
    <IconButton
      icon="edit"
      label="New chat"
      data-testid="sidebar-new-chat"
      className={strip ? undefined : 'h-nav w-auto aspect-square border-line-soft bg-surface'}
      onClick={actions.newChat}
    />
  );

  return (
    <Sidebar
      layout={layout}
      topRow={topRow}
      {...(inFlyout ? { 'data-testid': 'sidebar-flyout-panel' } : {})}
      header={
        strip ? (
          <SidebarHeaderRow className="mb-1.5 pl-2">
            <SidebarBrand />
            {newChat}
            {inFlyout ? collapse : null}
          </SidebarHeaderRow>
        ) : (
          <SidebarHeaderRow>
            <ServersMenu trigger={<ServerSwitcher data-testid="sidebar-server-switcher" server={status.serverName} />} />
            {collapse}
          </SidebarHeaderRow>
        )
      }
      actions={
        strip ? undefined : (
          <SidebarActionsRow>
            <SidebarSearchButton
              data-testid="sidebar-search"
              shortcut={shortcutFor('palette.toggle')}
              onClick={actions.openPalette}
            />
            {newChat}
          </SidebarActionsRow>
        )
      }
      nav={
        <SidebarNav data-testid="sidebar-nav">
          {NAV_DESTINATIONS.map((d) => (
            <NavItem
              key={d.id}
              icon={d.icon}
              label={d.label}
              active={active === d.id}
              data-testid={`sidebar-nav-${d.id}`}
              render={<Link to={d.path} />}
            />
          ))}
        </SidebarNav>
      }
      live={<LiveSections />}
      footer={
        <SidebarFooter
          data-testid="sidebar-connection"
          tone={status.connection.tone}
          label={status.connection.label}
          {...(status.address ? { address: status.address } : {})}
          notice={status.unrecoverable > 0 ? <GapNotice count={status.unrecoverable} since={status.lastGapAt} /> : null}
          update={strip ? null : <ConnectedUpdatePill placement="footer" />}
          action={
            <IconButton
              icon="settings"
              label="Settings"
              data-testid="sidebar-settings"
              shortcut={shortcutFor('app.settings')}
              onClick={actions.openSettings}
            />
          }
        />
      }
    />
  );
}

/** Linux native frame (desktop): Back / Forward at the top of the sidebar. */
function NativeNavRow() {
  const actions = useShellActions();
  const history = useNavHistory();
  return (
    <SidebarNavRow data-testid="sidebar-nav-row">
      <IconButton icon="back" label="Back" size="sm" data-testid="sidebar-back" disabled={!history.back} onClick={actions.back} />
      <IconButton
        icon="forward"
        label="Forward"
        size="sm"
        data-testid="sidebar-forward"
        disabled={!history.forward}
        onClick={actions.forward}
      />
    </SidebarNavRow>
  );
}

/** Needs you + Running: nothing until the feed has loaded, each only when it has items. */
function LiveSections() {
  const { data } = useAttention();
  const running = data?.running ?? [];
  const now = useNow(running.length > 0);
  if (!data) return null;
  return (
    <>
      {data.needsYou.length > 0 ? (
        <SidebarSection
          title="Needs you"
          count={data.counts.needsYou}
          countTone="warn"
          data-testid="sidebar-needs-you"
        >
          {data.needsYou.map((item) => (
            <NavItem
              key={item.key}
              label={item.title}
              subtitle={needsYouLine(item)}
              dot="needs_you"
              data-testid="sidebar-needs-you-row"
              render={<Link to={item.href} />}
            />
          ))}
        </SidebarSection>
      ) : null}
      {running.length > 0 ? (
        <SidebarSection
          title="Running"
          count={data.counts.running}
          spacing={data.needsYou.length > 0 ? 'next' : 'first'}
          data-testid="sidebar-running"
        >
          {running.map((item) => (
            <NavItem
              key={item.key}
              leading={<Icon concept="status-running" size={16} className="text-run" />}
              label={item.title}
              count={<Count>{formatElapsed(item.since, now)}</Count>}
              data-testid="sidebar-running-row"
              render={<Link to={item.href} />}
            />
          ))}
        </SidebarSection>
      ) : null}
    </>
  );
}

/** The second line of a Needs you row: the ask, else what it belongs to. */
function needsYouLine(item: AttentionItem): string {
  return item.ask?.summary ?? item.parent?.title ?? item.project?.name ?? 'Waiting for you';
}

/** The "events may be missing" notice with its one real fix (refetch from history). */
function GapNotice({ count, since }: { count: number; since: number | null }) {
  const { refetch, refetching } = useRefetchAfterGap();
  const time = since ? new Date(since).toLocaleTimeString() : null;
  return (
    <SidebarFooterNotice
      data-testid="connection-gap-notice"
      message={`${count} event${count === 1 ? '' : 's'} may be missing${time ? ` since ${time}` : ''} after a dropped connection.`}
      action={
        <Button size="sm" icon="refresh" loading={refetching} data-testid="connection-gap-badge" onClick={() => void refetch()}>
          Refresh
        </Button>
      }
    />
  );
}

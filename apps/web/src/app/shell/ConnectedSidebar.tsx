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
import type { AttentionItem } from '@generatorai/shared';
import { isDesktop, type ShellLayout } from '@/lib/desktop.js';
import { ACTIVITY_COPY, NAV_DESTINATIONS, navDestinationFor } from '@generatorai/shared/ui-contract';
import { useAttention, useAttentionCounts } from '@/hooks/attentionQueries.js';
import { useActivityStore } from '@/stores/activityStore.js';
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
  /** The Activity column is open: Needs you / Running move into it (D-92). */
  activityOpen?: boolean;
}

export function ConnectedSidebar({ layout, inFlyout = false, activityOpen = false }: ConnectedSidebarProps) {
  const actions = useShellActions();
  const status = useShellStatus();
  const { pathname } = useLocation();
  const active = navDestinationFor(pathname)?.id;
  const strip = layout === 'strip';

  const topRow =
    layout === 'mac' ? (
      // D-93: Back / Forward at the end of the traffic-light row (desktop only; the row is a drag handle, the buttons no-drag).
      <MacTrafficLightRow data-testid="sidebar-drag-region">{isDesktop ? <NavHistoryButtons testIdPrefix="sidebar" /> : null}</MacTrafficLightRow>
    ) : layout === 'native' && isDesktop ? (
      <NativeNavRow />
    ) : undefined;
  const activityToggle = <ActivityToggle />;

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
            {inFlyout ? null : activityToggle}
            {newChat}
            {inFlyout ? collapse : null}
          </SidebarHeaderRow>
        ) : (
          <SidebarHeaderRow className="gap-1">
            <ServersMenu trigger={<ServerSwitcher data-testid="sidebar-server-switcher" server={status.serverName} />} />
            {inFlyout ? null : activityToggle}
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
      live={activityOpen && !inFlyout ? null : <LiveSections />}
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
  return (
    <SidebarNavRow data-testid="sidebar-nav-row">
      <NavHistoryButtons testIdPrefix="sidebar" />
    </SidebarNavRow>
  );
}

/**
 * Back / Forward (D-93): disabled when Chromium's session history cannot move
 * that way; the tooltip names this host's chord (⌘[ / Alt+←).
 */
export function NavHistoryButtons({ testIdPrefix, tooltipSide = 'bottom' }: { testIdPrefix: string; tooltipSide?: 'bottom' | 'right' }) {
  const actions = useShellActions();
  const history = useNavHistory();
  return (
    <>
      <IconButton
        icon="back"
        label="Back"
        size="sm"
        tooltipSide={tooltipSide}
        shortcut={shortcutFor('nav.back')}
        data-testid={`${testIdPrefix}-back`}
        disabled={!history.back}
        onClick={actions.back}
      />
      <IconButton
        icon="forward"
        label="Forward"
        size="sm"
        tooltipSide={tooltipSide}
        shortcut={shortcutFor('nav.forward')}
        data-testid={`${testIdPrefix}-forward`}
        disabled={!history.forward}
        onClick={actions.forward}
      />
    </>
  );
}

/** Shows / hides the Activity column (D-92); `activity.toggle`. */
export function ActivityToggle({ size = 'md', tooltipSide = 'bottom' }: { size?: 'md' | 'lg'; tooltipSide?: 'bottom' | 'right' }) {
  const open = useActivityStore((s) => s.open);
  const toggle = useActivityStore((s) => s.toggle);
  const counts = useAttentionCounts();
  const needsYou = counts?.needsYou ?? 0;
  return (
    <IconButton
      icon="activity"
      label={open ? ACTIVITY_COPY.hide : needsYou > 0 ? `${ACTIVITY_COPY.show} · ${needsYou} need you` : ACTIVITY_COPY.show}
      size={size}
      tooltipSide={tooltipSide}
      pressed={open}
      shortcut={shortcutFor('activity.toggle')}
      data-testid="activity-toggle"
      data-activity-toggle=""
      onClick={toggle}
    />
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

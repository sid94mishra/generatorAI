// ────────────────────────────────────────────────────────────────
// ConnectedRail — S-03 wired (06 §3.5; board ChatNarrow).
//
// mac     44px empty drag row on top (the traffic lights overflow into the
//         main card's header, which gets the 30px inset — globals.css)
// strip   no app mark and no Search (the title strip holds them)
// native  as drawn
// Home carries the needs-you dot and the running counter shows how many
// things run — both only once the attention feed has loaded (D-36). The
// counter and Expand open the full sidebar (the flyout while the rail is
// forced, the preference otherwise). The app mark opens the Servers menu; the
// "Restart to update" icon sits above the connection dot while an update is
// ready (mac and native layouts — the strip layout's title strip has the pill).
// ────────────────────────────────────────────────────────────────

import { Link, useLocation } from 'react-router';
import { NAV_DESTINATIONS, navDestinationFor } from '@generatorai/shared/ui-contract';
import type { ShellLayout } from '@/lib/desktop.js';
import { useAttentionCounts } from '@/hooks/attentionQueries.js';
import { cn } from '@/ui/lib/cn.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { StatusDot } from '@/ui/primitives/StatusDot/StatusDot.js';
import { MacTrafficLightRow } from '@/ui/shell/MacTrafficLightRow/MacTrafficLightRow.js';
import {
  Rail,
  RailCounterButton,
  RailDivider,
  RailGroup,
  RailMark,
  RailSpacer,
  RailStatusDot,
} from '@/ui/shell/Rail/Rail.js';
import { useShellActions } from './shellActions.js';
import { ConnectedUpdatePill } from './ConnectedUpdatePill.js';
import { ServersMenu } from './ServersMenu.js';
import { shortcutFor, useShellStatus } from './useShellStatus.js';

export function ConnectedRail({ layout, covered = false }: { layout: ShellLayout; covered?: boolean }) {
  const actions = useShellActions();
  const status = useShellStatus();
  const counts = useAttentionCounts();
  const { pathname } = useLocation();
  const active = navDestinationFor(pathname)?.id;
  const strip = layout === 'strip';
  const connectionLabel = status.address ? `${status.connection.label} · ${status.address}` : status.connection.label;

  return (
    <Rail covered={covered} topRow={layout === 'mac' ? <MacTrafficLightRow data-testid="rail-drag-row" aria-hidden /> : undefined}>
      {strip ? null : (
        <ServersMenu
          side="right"
          trigger={
            <RailMark
              data-testid="rail-server"
              label={status.serverName ? `GeneratorAI · ${status.serverName}` : 'GeneratorAI'}
            />
          }
        />
      )}
      <IconButton
        icon="sidebar"
        label="Show sidebar"
        size="lg"
        tooltipSide="right"
        data-testid="rail-expand"
        data-sidebar-toggle=""
        shortcut={shortcutFor('sidebar.toggle')}
        onClick={actions.toggleSidebar}
      />
      <RailDivider />
      {strip ? null : (
        <IconButton
          icon="search"
          label="Search"
          size="lg"
          tooltipSide="right"
          data-testid="rail-search"
          shortcut={shortcutFor('palette.toggle')}
          onClick={actions.openPalette}
        />
      )}
      <IconButton
        icon="edit"
        label="New chat"
        size="lg"
        tooltipSide="right"
        data-testid="rail-new-chat"
        onClick={actions.newChat}
      />
      <RailDivider />
      <RailGroup role="navigation" aria-label="Main" data-testid="rail-nav">
        {NAV_DESTINATIONS.map((d) => {
          const isActive = active === d.id;
          const needsYou = d.id === 'home' && (counts?.needsYou ?? 0) > 0;
          return (
            <IconButton
              key={d.id}
              icon={d.icon}
              label={needsYou ? `${d.label} · ${counts?.needsYou} need you` : d.label}
              size="lg"
              tooltipSide="right"
              data-testid={`rail-nav-${d.id}`}
              {...(isActive ? { 'aria-current': 'page' as const } : {})}
              className={cn(isActive && 'bg-selected text-fg')}
              badge={needsYou ? <StatusDot tone="warn" ring /> : undefined}
              render={<Link to={d.path} />}
            />
          );
        })}
      </RailGroup>
      {counts && counts.running > 0 ? (
        <>
          <RailDivider />
          <RailCounterButton
            count={counts.running}
            label={`${counts.running} running`}
            data-testid="rail-running"
            data-sidebar-toggle=""
            onClick={actions.toggleSidebar}
          />
        </>
      ) : null}
      <RailSpacer />
      {strip ? null : <ConnectedUpdatePill placement="rail" />}
      <RailStatusDot data-testid="rail-connection" tone={status.connection.tone} label={connectionLabel} />
      <IconButton
        icon="settings"
        label="Settings"
        size="lg"
        tooltipSide="right"
        data-testid="rail-settings"
        shortcut={shortcutFor('app.settings')}
        onClick={actions.openSettings}
      />
    </Rail>
  );
}

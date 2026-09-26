// ────────────────────────────────────────────────────────────────
// ServersMenu — the 280px Servers menu (D-22, 06 §8, G-03; board
// DesktopWindows; 03 §4 S-02 "P-30 menu 280 wide"; Rosetta `menuitemradio`
// 40h two-line → Menu.RadioItem `description`).
//
// Opened from the sidebar's server switcher, the title strip's server chip
// (Windows, Linux custom title bar) and the rail's app mark. Real data only
// (D-36): the known servers from `useServers` (desktop: main's list with each
// entry probed by main; web: the paired-server catalog, only this page's own
// origin probed, the rest shown without a status), the active one checked.
// Choosing another switches to it (a new origin: main repoints the window on
// desktop, the page reloads on the web). "Add server…" exists only where this
// client can add one (the desktop shell's prompt); "Manage servers" opens
// Settings ▸ Security & devices. Keyboard: the trigger opens it with
// Enter/Space/ArrowDown, arrows move, Enter picks, Esc closes (Base UI Menu).
// ────────────────────────────────────────────────────────────────

import { useState, type ReactElement, type ReactNode } from 'react';
import type { ServerReachability } from '@generatorai/shared';
import { addServer, canAddServer, switchServer, useServers, type ServerListItem } from '@/hooks/serverQueries.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { StatusDot, type DotTone } from '@/ui/primitives/StatusDot/StatusDot.js';
import { displayAddress } from '@/hooks/useShellStatus.js';

/** A server's reachability as the menu shows it: dot + word, or nothing when unknown (never invented). */
const STATUS: Record<ServerReachability, { label: string; tone: DotTone | null }> = {
  connected: { label: 'Connected', tone: 'ok' },
  offline: { label: 'Offline', tone: null },
  unpaired: { label: 'Not paired', tone: 'warn' },
  error: { label: 'Not responding', tone: 'err' },
};

function serverStatus(status: ServerListItem['status']): ReactNode {
  if (status === 'unknown') return null;
  const { label, tone } = STATUS[status];
  return (
    <>
      {tone ? <StatusDot tone={tone} size="sm" /> : null}
      {label}
    </>
  );
}

export interface ServersMenuProps {
  /** The visible trigger (ServerSwitcher, TitleStripServerChip, RailMark), rendered by Menu.Trigger. */
  trigger: ReactElement;
  side?: 'bottom' | 'right';
  align?: 'start' | 'end';
}

export function ServersMenu({ trigger, side = 'bottom', align = 'start' }: ServersMenuProps) {
  const servers = useServers();
  const active = servers.data?.find((s) => s.active)?.id ?? '';
  const openSecurity = () => useSettingsUiStore.getState().openSettings('security');
  // Controlled: picking another server closes the menu at once. The switch
  // itself replaces the page (a new origin), but if the shell refuses it the
  // menu must not stay open over the page.
  const [open, setOpen] = useState(false);

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger render={trigger} />
      <Menu.Popup side={side} align={align} className="w-70" aria-label="Servers" data-testid="servers-menu">
        <Menu.RadioGroup
          value={active}
          onValueChange={(id) => {
            setOpen(false);
            if (typeof id === 'string' && id !== active) switchServer(id);
          }}
        >
          <Menu.GroupLabel>Servers</Menu.GroupLabel>
          {servers.data ? (
            servers.data.map((s) => (
              <Menu.RadioItem
                key={s.id}
                value={s.id}
                icon={s.kind === 'remote' ? 'server' : 'computer'}
                description={displayAddress(s.url) ?? s.url}
                trailing={serverStatus(s.status)}
                closeOnClick
                data-testid="servers-menu-server"
              >
                {s.label}
              </Menu.RadioItem>
            ))
          ) : (
            <Menu.Item disabled>{servers.error ? 'Could not list servers' : 'Loading servers…'}</Menu.Item>
          )}
        </Menu.RadioGroup>
        <Menu.Separator />
        {canAddServer() ? (
          <Menu.Item icon="plus" data-testid="servers-menu-add" onClick={addServer}>
            Add server…
          </Menu.Item>
        ) : null}
        <Menu.Item icon="settings" trailing="Security & devices" data-testid="servers-menu-manage" onClick={openSecurity}>
          Manage servers
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
}

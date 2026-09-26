// ────────────────────────────────────────────────────────────────
// ConnectedTitleStrip — S-06 wired (Windows; Linux with the custom title
// bar; 06 §3.5). Back / Forward follow Chromium's session history (main
// pushes it); the toggle runs `sidebar.toggle`; Search opens the palette; the
// server chip names the active server with the connection's dot. The update
// pill (`titlebar-update-pill`) and the Servers popover on the chip land in
// P3-06.
// ────────────────────────────────────────────────────────────────

import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { TitleStrip, TitleStripSearch, TitleStripServerChip } from '@/ui/shell/TitleStrip/TitleStrip.js';
import { useShellActions } from './shellActions.js';
import { useNavHistory } from './useNavHistory.js';
import { shortcutFor, useShellStatus } from './useShellStatus.js';

export function ConnectedTitleStrip() {
  const actions = useShellActions();
  const history = useNavHistory();
  const status = useShellStatus();
  return (
    <TitleStrip
      data-testid="app-titlebar"
      start={
        <>
          <IconButton
            icon="back"
            label="Back"
            size="sm"
            tooltipSide="bottom"
            data-testid="titlebar-back"
            disabled={!history.back}
            onClick={actions.back}
          />
          <IconButton
            icon="forward"
            label="Forward"
            size="sm"
            tooltipSide="bottom"
            data-testid="titlebar-forward"
            disabled={!history.forward}
            onClick={actions.forward}
          />
          <IconButton
            icon="sidebar"
            label="Toggle sidebar"
            size="sm"
            tooltipSide="bottom"
            className="ml-1"
            data-testid="titlebar-toggle-sidebar"
            data-sidebar-toggle=""
            shortcut={shortcutFor('sidebar.toggle')}
            onClick={actions.toggleSidebar}
          />
        </>
      }
      search={
        <TitleStripSearch
          data-testid="titlebar-search"
          shortcut={shortcutFor('palette.toggle')}
          onClick={actions.openPalette}
        />
      }
      end={
        status.serverName ? (
          <TitleStripServerChip
            data-testid="titlebar-server"
            label={status.serverName}
            tone={status.connection.tone}
            toneLabel={status.connection.label}
          />
        ) : null
      }
    />
  );
}

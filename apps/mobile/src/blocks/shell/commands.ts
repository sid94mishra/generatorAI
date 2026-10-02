// What a command does on mobile (06 §3.9, §3.10; D-24): one runner for the search palette, the hardware-key host
// and `command/<id>` links, so a command behaves the same from every entry point. Only commands with a working
// mobile surface are offered (MD-27); the rest arrive with their screens (M7/M8).
import { useCallback } from 'react';
import { router, usePathname } from 'expo-router';
import { COMMANDS, NAV_DESTINATIONS, type CommandId } from '@generatorai/shared/ui-contract';

import { useTheme } from '../../theme/ThemeProvider';
import { usePaneStore } from '../WorkspacePane/paneStore';
import { emitScopedCommand } from './commandBus';
import { goToModule, openNewChat, openSearch, openSettings } from './navigation';
import { useShellStore } from './shellStore';
import { useSidebarToggle } from './useSidebarToggle';
import { nextThemeMode, type ThemeModeName } from './themeCycle';

type Href = Parameters<typeof router.replace>[0];

/** Palette "Actions" available on mobile now (board order). */
export const MOBILE_PALETTE_ACTIONS = ['chat.new', 'theme.toggle', 'app.settings'] as const satisfies readonly CommandId[];

/** Global commands the hardware keyboard drives on mobile (06 §3.10). */
export const MOBILE_KEY_COMMANDS = [
  'palette.toggle',
  'chat.new',
  ...NAV_DESTINATIONS.map((d) => d.command),
  'app.settings',
  'nav.back',
  'sidebar.toggle',
  'dock.toggle',
] as const satisfies readonly CommandId[];

export function commandLabel(id: CommandId): string {
  return COMMANDS[id].label;
}

export function useCommandRunner(): (id: CommandId) => boolean {
  const pathname = usePathname();
  const { mode, setMode } = useTheme();
  const { onSidebarToggle } = useSidebarToggle();
  return useCallback(
    (id: CommandId): boolean => {
      // A focused surface (the palette, an open panel) answers its own commands first.
      if (emitScopedCommand(id)) return true;
      const destination = NAV_DESTINATIONS.find((d) => d.command === id);
      if (destination) {
        goToModule(destination.path, pathname);
        return true;
      }
      switch (id) {
        case 'palette.toggle':
          if (pathname === '/search') router.back();
          else openSearch();
          return true;
        case 'chat.new':
          openNewChat();
          return true;
        case 'app.settings':
          openSettings();
          return true;
        case 'theme.toggle':
          setMode(nextThemeMode(mode as ThemeModeName));
          return true;
        case 'sidebar.toggle':
          onSidebarToggle();
          return true;
        case 'dock.toggle': {
          const pane = usePaneStore.getState();
          if (!pane.claim) return false;
          pane.toggle();
          return true;
        }
        case 'nav.back':
          if (router.canGoBack()) router.back();
          else router.replace('/' as Href);
          return true;
        case 'dock.dismiss':
        case 'palette.close': {
          // Escape: close the topmost overlay the shell owns.
          const pane = usePaneStore.getState();
          if (pane.fullscreen) pane.setFullscreen(false);
          else if (pane.open) pane.setOpen(false);
          else if (useShellStore.getState().drawerOpen) useShellStore.getState().setDrawerOpen(false);
          else return false;
          return true;
        }
        default:
          return false;
      }
    },
    [pathname, mode, setMode, onSidebarToggle],
  );
}

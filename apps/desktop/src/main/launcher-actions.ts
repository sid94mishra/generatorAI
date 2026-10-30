// ────────────────────────────────────────────────────────────────
// OS launcher shortcuts (06 §8, P3-06): the macOS Dock menu and the Windows
// JumpList. Linux gets the same entries as `.desktop` actions at packaging
// time (`scripts/lib/build-config.mjs`, parity-tested against the registry).
//
// All three list `LAUNCHER_ACTIONS` from the shared registry, in order, with
// registry labels: New Chat and New Workflow run the registry commands, Home
// opens that section.
//   macOS     the Dock menu runs in the live process: commands go through
//             `sendCommand` (held until the page reports in), Home through
//             `navigateTo`. With every window closed it first brings one back.
//   Windows   a JumpList task relaunches the exe with the action's deep link
//             (`generatorai://command/chat.new`, `generatorai://`); the single-
//             instance lock hands it to the running app (`second-instance`),
//             or a cold start picks it out of argv. Same path as any link.
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import {
  LAUNCHER_ACTIONS,
  NAV_DESTINATIONS,
  launcherActionLabel,
  launcherActionLink,
  type LauncherAction,
} from '@generatorai/shared/ui-contract';
import { getWindowManager } from './window-manager';
import { menuLabel } from './menu-label';
import { isMac, isWindows } from './platform';

/** Runs a launcher action in this process (Dock menu). */
export function runLauncherAction(action: LauncherAction): void {
  const wm = getWindowManager();
  // A Dock menu click does not emit `activate`; with every window closed the
  // command or route would be held for a window nobody opens.
  wm.restoreFromTray();
  if (action.kind === 'command') {
    wm.sendCommand(action.command);
    return;
  }
  const dest = NAV_DESTINATIONS.find((d) => d.id === action.destination);
  if (dest) wm.navigateTo(dest.path);
}

/** The macOS Dock menu: commands, a separator, then the destinations. */
export function dockMenuTemplate(): MenuItemConstructorOptions[] {
  const item = (action: LauncherAction): MenuItemConstructorOptions => ({
    label: menuLabel(launcherActionLabel(action)),
    click: () => runLauncherAction(action),
  });
  const commands = LAUNCHER_ACTIONS.filter((a) => a.kind === 'command').map(item);
  const destinations = LAUNCHER_ACTIONS.filter((a) => a.kind === 'destination').map(item);
  return [...commands, { type: 'separator' }, ...destinations];
}

/**
 * Windows JumpList tasks. `program`/`leadingArgs` start this app: the packaged
 * exe with no arguments, or in development Electron plus the app's entry
 * script (without it the task would open a bare Electron).
 */
export function jumpListTasks(program: string, leadingArgs: readonly string[] = []): Electron.Task[] {
  const prefix = leadingArgs.map((a) => `"${a}"`).join(' ');
  return LAUNCHER_ACTIONS.map((action) => {
    const label = menuLabel(launcherActionLabel(action));
    return {
      program,
      arguments: prefix ? `${prefix} ${launcherActionLink(action)}` : launcherActionLink(action),
      iconPath: program,
      iconIndex: 0,
      title: label,
      description: action.kind === 'command' ? `${label} in GeneratorAI` : `Open GeneratorAI ${label}`,
    };
  });
}

/** Installs the Dock menu (macOS) or the JumpList (Windows). No-op elsewhere. */
export function registerLauncherActions(): void {
  if (isMac) {
    app.dock?.setMenu(Menu.buildFromTemplate(dockMenuTemplate()));
  }
  if (isWindows) {
    const dev = process.defaultApp && process.argv.length >= 2;
    app.setUserTasks(jumpListTasks(process.execPath, dev ? [path.resolve(process.argv[1] ?? '')] : []));
  }
}

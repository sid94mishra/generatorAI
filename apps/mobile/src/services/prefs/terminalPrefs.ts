// Settings › Browser & terminal (MD-30, MDF-109): the shell this device opens terminals with, per server (the shell
// is the server host's — `pwsh.exe` only exists on a Windows server). Empty = the server's default shell. Applied
// the next time a terminal tab opens (`api.terminals.create({ shell })`).
import { useSyncExternalStore } from 'react';

import { prefs } from '../storage/prefs';

const key = (serverId: string): string => `srv.${serverId}.terminalShell`;
const listeners = new Set<() => void>();

export function readTerminalShell(serverId: string | null): string {
  return serverId ? (prefs.getString(key(serverId)) ?? '') : '';
}

export function writeTerminalShell(serverId: string, shell: string): void {
  if (shell) prefs.setString(key(serverId), shell);
  else prefs.delete(key(serverId));
  for (const l of listeners) l();
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTerminalShell(serverId: string | null): string {
  return useSyncExternalStore(subscribe, () => readTerminalShell(serverId), () => '');
}

/** The shells a server on `platform` offers (the default first, as ''). */
export function shellOptions(platform: string | undefined): Array<{ value: string; label: string }> {
  const base = [{ value: '', label: 'Server default' }];
  if (platform === 'win32') return [...base, { value: 'pwsh.exe', label: 'PowerShell 7 (pwsh.exe)' }, { value: 'powershell.exe', label: 'Windows PowerShell' }, { value: 'cmd.exe', label: 'Command Prompt (cmd.exe)' }];
  return [...base, { value: '/bin/bash', label: 'bash' }, { value: '/bin/zsh', label: 'zsh' }, { value: '/bin/sh', label: 'sh' }];
}

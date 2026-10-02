// KeyCommandHost (06 §1.2 #16, §3.10; M5-09): registers the hardware-keyboard shortcuts from COMMANDS with the
// native key-command module and runs them through the shell's one command runner. Global shortcuts always; ↑ / ↓ /
// Escape only while an overlay (the palette, the pane, the drawer) is open, so arrows keep moving text cursors and
// terminal history otherwise. Suspended while a surface owns keys (a focused terminal, MD-19). It also feeds the
// hardware-keyboard presence store (KbdHint). Renders nothing; a no-op on clients without the native functions.
import { useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'expo-router';
import { isCommandId } from '@generatorai/shared/ui-contract';

import {
  addKeyCommandListeners,
  isHardwareKeyboardAttached,
  keyCommandsAvailable,
  nativeKeyCommands,
  setKeyCommands,
  setKeyCommandsSuspended,
} from '../../services/native/keyCommands';
import { nativePlatform } from '../../ui/platform/geometry';
import { setHardwareKeyboardAttached } from '../../ui/platform/keyboard';
import { usePaneStore } from '../WorkspacePane/paneStore';
import { activeKeyCommandIds } from './commandSets';
import { useCommandRunner } from './commands';
import { useShellStore } from './shellStore';

export function KeyCommandHost(): null {
  const pathname = usePathname();
  const run = useCommandRunner();
  const paneOpen = usePaneStore((s) => s.open && s.claim !== null);
  const drawerOpen = useShellStore((s) => s.drawerOpen);
  const surfaceOwnsKeys = useShellStore((s) => s.gestureOwner === 'surface');
  const palette = pathname === '/search';

  const ids = useMemo(() => activeKeyCommandIds({ palette, overlayOpen: paneOpen || drawerOpen }), [palette, paneOpen, drawerOpen]);
  useEffect(() => {
    if (keyCommandsAvailable()) setKeyCommands(nativeKeyCommands(ids, nativePlatform));
  }, [ids]);
  useEffect(() => {
    if (keyCommandsAvailable()) setKeyCommandsSuspended(surfaceOwnsKeys);
  }, [surfaceOwnsKeys]);

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  useEffect(() => {
    setHardwareKeyboardAttached(isHardwareKeyboardAttached());
    return addKeyCommandListeners(
      (id) => {
        if (isCommandId(id)) runRef.current(id);
      },
      (attached) => setHardwareKeyboardAttached(attached),
    );
  }, []);
  return null;
}

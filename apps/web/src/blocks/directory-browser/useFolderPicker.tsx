// ────────────────────────────────────────────────────────────────
// useFolderPicker — "choose a folder" with the fewest steps (D-136).
//
// In the desktop app showing this computer's own server, `open()` shows the
// OS folder dialog (Electron `showOpenDialog`, local-only IPC) and hands the
// absolute path straight to `onPick` — no in-app modal. Everywhere else it
// opens the server-side DirectoryBrowser, at home with shortcuts:
//   • a plain browser cannot see absolute paths (the File System Access API
//     returns a name only);
//   • the desktop app showing a REMOTE server would pick a path on the wrong
//     machine (and main refuses the channel to a remote page).
// Render `dialog` once next to the trigger.
// ────────────────────────────────────────────────────────────────

import { useCallback, useState, type ReactNode } from 'react';
import { desktopFolders } from '@/lib/desktop.js';
import { DirectoryBrowser } from './DirectoryBrowser.js';

export interface UseFolderPickerOptions {
  onPick: (path: string) => void;
  /** Where the fallback browser opens (default: the server user's home). */
  initialPath?: string | undefined;
  /** The fallback browser's one-line description. */
  description?: string | undefined;
}

export interface FolderPicker {
  open: () => Promise<void>;
  /** The fallback DirectoryBrowser; render it once. */
  dialog: ReactNode;
}

export function useFolderPicker({ onPick, initialPath, description }: UseFolderPickerOptions): FolderPicker {
  const [browsing, setBrowsing] = useState(false);

  const open = useCallback(async () => {
    if (await desktopFolders.canPickNatively()) {
      try {
        const picked = await desktopFolders.pick(initialPath);
        if (picked) onPick(picked);
        return;
      } catch {
        // Refused or failed (e.g. the window switched servers): browse instead.
      }
    }
    setBrowsing(true);
  }, [onPick, initialPath]);

  const dialog = (
    <DirectoryBrowser
      open={browsing}
      onClose={() => setBrowsing(false)}
      onPick={onPick}
      initialPath={initialPath}
      description={description}
    />
  );
  return { open, dialog };
}

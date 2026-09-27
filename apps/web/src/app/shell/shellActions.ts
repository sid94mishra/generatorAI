// ────────────────────────────────────────────────────────────────
// The shell's buttons run the same handlers as the command registry (D-24):
// Search = `palette.toggle`'s open, New chat = `chat.new`, Settings =
// `app.settings`, the sidebar toggles = `sidebar.toggle`. One place, so a
// button and its shortcut can never disagree.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useShellStore } from '@/stores/shellStore.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { useNewChatStore } from '@/stores/newChatStore.js';

export interface ShellActions {
  openPalette: () => void;
  newChat: () => void;
  openSettings: () => void;
  toggleSidebar: () => void;
  back: () => void;
  forward: () => void;
}

export function useShellActions(): ShellActions {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      openPalette: () => useShellStore.getState().setCommandPaletteOpen(true),
      // R-1: the sidebar/rail icon opens the 640 dialog directly (04 §0).
      newChat: () => useNewChatStore.getState().open(),
      openSettings: () => useSettingsUiStore.getState().openSettings(),
      toggleSidebar: () => useShellStore.getState().toggleSidebar(),
      back: () => void navigate(-1),
      forward: () => void navigate(1),
    }),
    [navigate],
  );
}

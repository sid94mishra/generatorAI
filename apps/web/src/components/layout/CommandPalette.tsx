// ────────────────────────────────────────────────────────────────
// CommandPalette — global ⌘K / Ctrl+K palette. Navigation + quick
// actions. Opened via uiStore (keybinding registered in AppLayout).
// Theme/accent switching now lives in Settings → General.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  MessageSquare,
  GitBranch,
  FileCode2,
  RefreshCw,
  Settings,
  Plus,
} from 'lucide-react';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  Kbd,
} from '@/components/ui/index.js';
import { useUiStore } from '@/stores/uiStore.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';

const NAV_ITEMS: { label: string; path: string; icon: React.ElementType }[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Projects', path: '/projects', icon: FolderKanban },
  { label: 'Chats', path: '/chats', icon: MessageSquare },
  { label: 'Workflows', path: '/workflows', icon: GitBranch },
  { label: 'Scripts', path: '/scripts', icon: FileCode2 },
  { label: 'Automations', path: '/automations', icon: RefreshCw },
];

const ACTION_ITEMS: { label: string; path: string }[] = [
  { label: 'New Chat', path: '/chats' },
  { label: 'New Workflow', path: '/workflows/new' },
  { label: 'New Automation', path: '/automations/new' },
  { label: 'New Project', path: '/projects/new' },
];

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const openSettings = useSettingsUiStore((s) => s.openSettings);

  /** Close the palette, then run the command. */
  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigate">
          {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
            <CommandItem key={path} value={`go-${label}`} keywords={[label]} onSelect={() => run(() => navigate(path))}>
              <Icon className="h-4 w-4 text-muted-foreground" />
              {label}
            </CommandItem>
          ))}
          <CommandItem value="go-Settings" keywords={['Settings', 'preferences']} onSelect={() => run(() => openSettings())}>
            <Settings className="h-4 w-4 text-muted-foreground" />
            Settings
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Actions">
          {ACTION_ITEMS.map(({ label, path }) => (
            <CommandItem key={label} value={`action-${label}`} keywords={[label]} onSelect={() => run(() => navigate(path))}>
              <Plus className="h-4 w-4 text-muted-foreground" />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>

      {/* Footer — keyboard hints, matching the app's control conventions. */}
      <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <Kbd keys={['enter']} />
            <span>Select</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd keys={['↑', '↓']} />
            <span>Navigate</span>
          </span>
        </div>
        <span className="flex items-center gap-1.5">
          <Kbd keys={['esc']} />
          <span>Close</span>
        </span>
      </div>
    </CommandDialog>
  );
}

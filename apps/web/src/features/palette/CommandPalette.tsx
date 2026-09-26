// ────────────────────────────────────────────────────────────────
// F-palette-01 CommandPalette — the global "Search or jump to" palette
// (board CommandPalette; 03-domain §3.8; 06 §5.3 Palette).
//
// S-10 CommandPaletteFrame + C-21 CommandList over Base UI Autocomplete.
// Opened by the `palette.toggle` command (Mod+K on the web — also from a text
// field, D-46 `firesInEditable` — Cmd/Ctrl+K from the desktop menu, the
// sidebar Search button); open state is `uiStore.commandPaletteOpen`.
// Self-contained: mount `<CommandPalette />` once inside the router.
//
// Rows run through the command registry (`runCommand`), so a palette row does
// exactly what the menu item and the key binding do. Recent chats are real
// (useChats + the attention feed for the live badge), fetched only while the
// palette is open (the body mounts with the dialog). Tab on a row lists its actions (Open, Open in new tab and
// Copy link in a browser tab, Archive on a chat). No entity search (P5-12).
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { chatLiveSets } from '@generatorai/client-core';
import { CommandPaletteFrame } from '@/ui/shell/CommandPaletteFrame/CommandPaletteFrame.js';
import { CommandList, type CommandAction, type CommandGroup, type CommandItem } from '@/ui/patterns/CommandList/CommandList.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { useUiStore } from '@/stores/uiStore.js';
import { useChats } from '@/hooks/chatListQueries.js';
import { useAttention } from '@/hooks/attentionQueries.js';
import { useProjects } from '@/hooks/projectQueries.js';
import { useArchiveChat } from '@/hooks/queries.js';
import { useTheme } from '@/providers/ThemeProvider.js';
import { commandHost, isMacOS } from '@/lib/desktop.js';
import { runCommand } from '@/lib/commandRunner.js';
import {
  buildPaletteModel,
  paletteActionFooterHints,
  paletteFooterHints,
  type PaletteActionId,
  type PaletteEntry,
  type RecentChat,
} from './paletteModel.js';

/** How many recent chats the palette lists. */
const RECENT_CHAT_LIMIT = 5;

const HOST = { host: commandHost, mac: isMacOS } as const;
const FOOTER_HINTS = paletteFooterHints(HOST);
const ACTION_FOOTER_HINTS = paletteActionFooterHints(HOST);

/** The newest active chats with project names and live state; undefined while loading. */
function useRecentChats(): readonly RecentChat[] | undefined {
  const chats = useChats({ status: 'active', limit: RECENT_CHAT_LIMIT });
  const attention = useAttention();
  const projects = useProjects();
  return useMemo(() => {
    if (!chats.data) return undefined;
    const live = chatLiveSets(attention.data);
    const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
    return chats.data.items.map((chat) => ({
      id: chat.id,
      name: chat.name,
      ...(chat.projectId && projectName.has(chat.projectId) ? { projectName: projectName.get(chat.projectId) } : {}),
      ...(live?.needsYou.has(chat.id) ? { live: 'needs_you' as const } : live?.running.has(chat.id) ? { live: 'running' as const } : {}),
    }));
  }, [chats.data, attention.data, projects.data]);
}

/** A chat's live state as the board's trailing badge. */
function liveBadge(entry: PaletteEntry | undefined) {
  if (entry?.kind !== 'chat' || !entry.live) return null;
  return entry.live === 'needs_you' ? <StatusBadge state="needs_you" context="chat" /> : <StatusBadge state="running" context="chat" />;
}

/** The global command palette. Mount once, inside the router. */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  return (
    <CommandPaletteFrame open={open} onOpenChange={setOpen}>
      {/* Mounted only while open: every opening starts from an empty query. */}
      <PaletteBody close={() => setOpen(false)} />
    </CommandPaletteFrame>
  );
}

function PaletteBody({ close }: { close: () => void }) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const archiveChat = useArchiveChat();
  const recentChats = useRecentChats();
  const [query, setQuery] = useState('');

  const model = useMemo(
    () => buildPaletteModel({ ...HOST, resolvedTheme, recentChats }),
    [resolvedTheme, recentChats],
  );
  const groups = useMemo<CommandGroup[]>(
    () =>
      model.groups.map((group) => ({
        ...group,
        items: group.items.map((item) => {
          const badge = liveBadge(model.entries.get(item.value));
          return badge ? { ...item, badge } : item;
        }),
      })),
    [model],
  );

  /** Closes the palette first, so a command that opens its own dialog gets the focus. */
  const run = (fn: () => void) => {
    close();
    fn();
  };

  const openEntry = (entry: PaletteEntry) => {
    if (entry.kind === 'command') runCommand(entry.id);
    else navigate(entry.path);
  };

  const onSelect = (item: CommandItem) => {
    const entry = model.entries.get(item.value);
    if (entry) run(() => openEntry(entry));
  };

  const onAction = (item: CommandItem, action: CommandAction) => {
    const entry = model.entries.get(item.value);
    if (!entry) return;
    const { path } = entry;
    switch (action.value as PaletteActionId) {
      case 'open':
        run(() => openEntry(entry));
        break;
      case 'open-new-tab':
        if (path) run(() => window.open(path, '_blank', 'noopener'));
        break;
      case 'copy-link':
        if (path) {
          run(() => {
            // Refused only without a user gesture or clipboard permission; nothing to retry.
            navigator.clipboard.writeText(new URL(path, window.location.origin).href).catch(() => undefined);
          });
        }
        break;
      case 'archive':
        if (entry.kind === 'chat') run(() => archiveChat.mutate(entry.chatId));
        break;
    }
  };

  return (
    <CommandList
      query={query}
      onQueryChange={setQuery}
      groups={groups}
      onSelect={onSelect}
      onAction={onAction}
      footerHints={FOOTER_HINTS}
      actionFooterHints={ACTION_FOOTER_HINTS}
    />
  );
}

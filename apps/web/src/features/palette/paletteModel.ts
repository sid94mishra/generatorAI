// ────────────────────────────────────────────────────────────────
// Command palette model (F-palette-01) — pure: registry + real data in,
// CommandList groups out. React-free so the host rules are unit-tested.
//
//   <entities>    while a query is typed: the server's entity search (G-18)
//                 as one group per type — Chats, Projects, Agents, Workflows,
//                 Automations, Scripts — in the order of each type's best
//                 hit, above everything else (board CommandPalette). The
//                 server already matched them (title, description, tags), so
//                 the rows are `preMatched`; a chat already listed under
//                 Recent chats is not repeated.
//   Go to         NAV_DESTINATIONS (D-22 order) with the host's binding
//   Actions       `palette: true` registry commands that are not a
//                 destination, board order first (New chat, New workflow,
//                 Toggle theme, Open settings), then registry order
//   Recent chats  the newest active chats (useChats), with a live status
//                 badge from the attention feed; a note row when none
//
// Hints follow the host (D-24): web shows sequences ("G then C"), desktop
// macOS ⌘ chords, desktop Windows/Linux Ctrl chords.
// ────────────────────────────────────────────────────────────────

import {
  COMMANDS,
  NAV_DESTINATIONS,
  RENDERER_COMMAND_IDS,
  bindingFor,
  formatBinding,
  type CommandDef,
  type CommandId,
  type Host,
  type RendererCommandId,
} from '@generatorai/shared/ui-contract';
import type { IconConcept } from '@generatorai/design-tokens';
import type { SearchEntityType, SearchResult, StatusState } from '@generatorai/shared';
import type { Chords, CommandAction, CommandGroup, CommandHint, CommandItem } from '@/ui/patterns/CommandList/CommandList.js';

export interface PaletteHost {
  host: Host;
  /** The viewer's OS is macOS (web `Mod` = ⌘). */
  mac: boolean;
}

/** One recent chat, already joined with its project name and live state. */
export interface RecentChat {
  id: string;
  name: string;
  projectName?: string;
  /** Live state from the attention feed; other states show no badge. */
  live?: 'needs_you' | 'running';
}

export type PaletteEntry =
  /** `path`: the route a Go to row opens (for Open in new tab / Copy link). */
  | { kind: 'command'; id: RendererCommandId; path?: string }
  | { kind: 'chat'; chatId: string; path: string; live?: RecentChat['live'] }
  /** A server search hit (G-18); `status` is the entity's D-18 state when it has one. */
  | { kind: 'entity'; type: SearchEntityType; id: string; path: string; status?: StatusState };

export type PaletteActionId = 'open' | 'open-new-tab' | 'copy-link' | 'archive';

export interface PaletteModelInput extends PaletteHost {
  resolvedTheme: 'dark' | 'light';
  /** `undefined` while loading (no group), `[]` when there are none (note row). */
  recentChats: readonly RecentChat[] | undefined;
  /** Entity search hits for the typed query (server-ranked); absent or empty = no entity groups. */
  searchResults?: readonly SearchResult[];
}

/** Group label and row icon per searchable entity type. */
export const ENTITY_GROUPS: Record<SearchEntityType, { label: string; icon: IconConcept }> = {
  chat: { label: 'Chats', icon: 'chats' },
  project: { label: 'Projects', icon: 'projects' },
  agent: { label: 'Agents', icon: 'agents' },
  workflow: { label: 'Workflows', icon: 'workflows' },
  automation: { label: 'Automations', icon: 'automations' },
  script: { label: 'Scripts', icon: 'scripts' },
};

/**
 * Entity search hits as one group per type, ordered by each type's best
 * (first) hit. Chats already shown under Recent chats are dropped.
 */
function entityGroups(
  results: readonly SearchResult[],
  recentChatIds: ReadonlySet<string>,
  host: Host,
  entries: Map<string, PaletteEntry>,
): CommandGroup[] {
  const byType = new Map<SearchEntityType, CommandItem[]>();
  for (const hit of results) {
    if (hit.type === 'chat' && recentChatIds.has(hit.id)) continue;
    const value = `entity:${hit.type}:${hit.id}`;
    if (entries.has(value)) continue;
    entries.set(value, { kind: 'entity', type: hit.type, id: hit.id, path: hit.href, ...(hit.status ? { status: hit.status } : {}) });
    const rows = byType.get(hit.type) ?? [];
    rows.push({
      value,
      label: hit.title,
      icon: ENTITY_GROUPS[hit.type].icon,
      ...(hit.subtitle ? { meta: hit.subtitle } : {}),
      preMatched: true,
      actions: linkActions(host),
    });
    byType.set(hit.type, rows);
  }
  return [...byType].map(([type, items]) => ({ label: ENTITY_GROUPS[type].label, items }));
}

/** Actions listed first, in the CommandPalette board's order. */
const ACTION_ORDER: readonly RendererCommandId[] = ['chat.new', 'workflow.new', 'theme.toggle', 'app.settings'];

/** Extra words a row answers to (the legacy palette's keywords, kept). */
const KEYWORDS: Partial<Record<RendererCommandId, readonly string[]>> = {
  'nav.home': ['dashboard', 'go'],
  'nav.chats': ['go'],
  'nav.projects': ['go'],
  'nav.agents': ['go'],
  'nav.workflows': ['go'],
  'nav.automations': ['go'],
  'nav.scripts': ['go'],
  'app.settings': ['settings', 'preferences'],
  'theme.toggle': ['dark', 'light', 'appearance', 'mode'],
  'shortcuts.show': ['keys', 'help', 'hotkeys'],
};

/** The binding of `id` on this host as Kbd chords, or undefined when unbound there. */
export function commandChords(id: CommandId, { host, mac }: PaletteHost): Chords | undefined {
  const binding = bindingFor(id, host);
  return binding ? formatBinding(binding, host, { mac }) : undefined;
}

/** Footer hints from the palette's own (display-only) registry entries. */
export function paletteFooterHints(h: PaletteHost): CommandHint[] {
  const keys = (id: CommandId): Chords => commandChords(id, h) ?? [];
  return [
    { keys: [...keys('palette.prev'), ...keys('palette.next')], label: 'Navigate' },
    { keys: keys('palette.open'), label: 'Open' },
    { keys: keys('palette.actions'), label: 'Actions' },
    { keys: keys('palette.close'), label: 'Close', end: true },
  ];
}

/** Hints while a row's actions are listed (Esc goes back, not closed). */
export function paletteActionFooterHints(h: PaletteHost): CommandHint[] {
  const keys = (id: CommandId): Chords => commandChords(id, h) ?? [];
  return [
    { keys: [...keys('palette.prev'), ...keys('palette.next')], label: 'Navigate' },
    { keys: keys('palette.open'), label: 'Run' },
    { keys: keys('palette.close'), label: 'Back', end: true },
  ];
}

/**
 * Row actions (Tab) for something with a URL. A browser tab can open it in a
 * new tab and copy a link that works elsewhere; the desktop app has neither,
 * so there it is Open only (and a lone Open is no list at all).
 */
function linkActions(host: Host, extra: readonly CommandAction[] = []): CommandAction[] | undefined {
  const actions: CommandAction[] = [{ value: 'open', label: 'Open', icon: 'forward', chords: [['↵']] }];
  if (host === 'web') {
    actions.push({ value: 'open-new-tab', label: 'Open in new tab', icon: 'external-link' });
    actions.push({ value: 'copy-link', label: 'Copy link', icon: 'link' });
  }
  actions.push(...extra);
  return actions.length > 1 ? actions : undefined;
}

export interface PaletteModel {
  groups: CommandGroup[];
  /** What each row value does. */
  entries: ReadonlyMap<string, PaletteEntry>;
}

export function buildPaletteModel(input: PaletteModelInput): PaletteModel {
  const entries = new Map<string, PaletteEntry>();
  const groups: CommandGroup[] = [];

  if (input.searchResults?.length) {
    const recentIds = new Set((input.recentChats ?? []).map((c) => c.id));
    groups.push(...entityGroups(input.searchResults, recentIds, input.host, entries));
  }

  groups.push({
    label: 'Go to',
    items: NAV_DESTINATIONS.map((dest) => {
      const value = `nav:${dest.id}`;
      entries.set(value, { kind: 'command', id: dest.command, path: dest.path });
      return {
        value,
        label: dest.label,
        icon: dest.icon as IconConcept,
        keywords: KEYWORDS[dest.command],
        chords: commandChords(dest.command, input),
        actions: linkActions(input.host),
      };
    }),
  });

  const navCommands = new Set<RendererCommandId>(NAV_DESTINATIONS.map((d) => d.command));
  const def = (id: RendererCommandId): CommandDef => COMMANDS[id];
  const listed = RENDERER_COMMAND_IDS.filter((id) => def(id).palette === true && !navCommands.has(id));
  const ordered = [...ACTION_ORDER.filter((id) => listed.includes(id)), ...listed.filter((id) => !ACTION_ORDER.includes(id))];
  const dark = input.resolvedTheme === 'dark';
  groups.push({
    label: 'Actions',
    items: ordered.map((id) => {
      const value = `cmd:${id}`;
      entries.set(value, { kind: 'command', id });
      const { label, icon } = def(id);
      const isTheme = id === 'theme.toggle';
      return {
        value,
        label,
        icon: (isTheme ? (dark ? 'mode-dark' : 'mode-light') : icon) as IconConcept | undefined,
        keywords: KEYWORDS[id],
        meta: isTheme ? (dark ? 'Dark → Light' : 'Light → Dark') : undefined,
        chords: commandChords(id, input),
      };
    }),
  });

  if (input.recentChats) {
    groups.push({
      label: 'Recent chats',
      items:
        input.recentChats.length === 0
          ? [{ value: 'chat:none', label: 'No recent chats', disabled: true, note: true }]
          : input.recentChats.map((chat) => {
              const value = `chat:${chat.id}`;
              entries.set(value, { kind: 'chat', chatId: chat.id, path: `/chats/${chat.id}`, live: chat.live });
              return {
                value,
                label: chat.name,
                icon: 'chats' as IconConcept,
                meta: chat.projectName,
                keywords: chat.projectName ? [chat.projectName] : undefined,
                actions: linkActions(input.host, [{ value: 'archive', label: 'Archive', icon: 'archive' }]),
              };
            }),
    });
  }

  return { groups, entries };
}

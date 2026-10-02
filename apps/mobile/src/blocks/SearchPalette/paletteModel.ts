// Search palette model (03 MB-21; 06 §3.9; MSearch). Pure: registry, server hits and recents in, groups out.
//
//   query typed    server entity hits (G-18) as one group per type, ordered by each type's best hit (`kind`
//                  puts one type first: the "Run workflow…" quick action), then Go to (NAV_DESTINATIONS), then
//                  Actions (the mobile commands), then Recent chats — all matched with the client-core fuzzy
//                  matcher, prefix and substring hits first.
//   empty query    Recent (destinations opened from here, per server), Actions, Go to, Recent chats.
//   offline        Actions and Go to only, with a "Server offline" note (local rows need no server).
import { COMMANDS, NAV_DESTINATIONS, type CommandId } from '@generatorai/shared/ui-contract';
import type { SearchEntityType, SearchResult, StatusState } from '@generatorai/shared';
import type { MobileIconConcept } from '@generatorai/design-tokens';
import { fuzzyMatch } from '@generatorai/client-core';

export interface RecentChat {
  id: string;
  name: string;
  projectName?: string;
  live?: 'needs_you' | 'running';
}

/** A destination opened from the palette (kept per server, newest first). */
export interface RecentEntry {
  key: string;
  title: string;
  subtitle?: string;
  icon: MobileIconConcept;
  href: string;
}

export interface PaletteRow {
  key: string;
  title: string;
  subtitle?: string;
  icon: MobileIconConcept;
  /** Trailing hint ("daily 02:00", "Dark → Light"). */
  hint?: string;
  /** Live status badge (recent chats, entity hits with a state). */
  status?: StatusState;
  /** Open this route… */
  href?: string;
  /** …or run this command. */
  command?: CommandId;
}

export interface PaletteGroup {
  key: string;
  label: string;
  rows: PaletteRow[];
  note?: string;
}

export interface PaletteInput {
  query: string;
  results?: readonly SearchResult[];
  recentChats?: readonly RecentChat[];
  recents?: readonly RecentEntry[];
  offline: boolean;
  /** "Dark → Light": what Toggle theme will do. */
  themeHint: string;
  /** `/search?kind=workflows`: that type's group first. */
  kind?: SearchEntityType;
  /** Commands with a mobile surface (MOBILE_PALETTE_ACTIONS). */
  actions: readonly CommandId[];
}

export const ENTITY_GROUPS: Record<SearchEntityType, { label: string; icon: MobileIconConcept }> = {
  chat: { label: 'Chats', icon: 'chats' },
  project: { label: 'Projects', icon: 'projects' },
  agent: { label: 'Agents', icon: 'agents' },
  workflow: { label: 'Workflows', icon: 'workflows' },
  automation: { label: 'Automations', icon: 'automations' },
  script: { label: 'Scripts', icon: 'scripts' },
};

const ACTION_ICONS: Partial<Record<CommandId, MobileIconConcept>> = { 'chat.new': 'edit', 'app.settings': 'settings', 'theme.toggle': 'mode-dark' };
const KEYWORDS: Partial<Record<CommandId, readonly string[]>> = {
  'nav.home': ['dashboard'],
  'app.settings': ['settings', 'preferences'],
  'theme.toggle': ['dark', 'light', 'appearance', 'mode'],
};
const ACTION_LABEL: Partial<Record<CommandId, string>> = { 'app.settings': 'Settings' };

/** 0 = prefix, 1 = substring, 2 = fuzzy, null = no match. */
export function matchRank(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 0;
  if (t.includes(q)) return 1;
  return fuzzyMatch(q, t) ? 2 : null;
}

function filterRows(query: string, rows: readonly PaletteRow[], keywords: (row: PaletteRow) => readonly string[] = () => []): PaletteRow[] {
  if (!query.trim()) return [...rows];
  const ranked: { row: PaletteRow; rank: number; i: number }[] = [];
  rows.forEach((row, i) => {
    const ranks = [row.title, row.subtitle ?? '', ...keywords(row)].map((t) => matchRank(query, t)).filter((r): r is number => r !== null);
    if (ranks.length) ranked.push({ row, rank: Math.min(...ranks), i });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.i - b.i).map((r) => r.row);
}

/** The matched part of `text` for the 600-weight highlight (MD-28: never 700), or null. */
export function highlightRange(query: string, text: string): { start: number; end: number } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const start = text.toLowerCase().indexOf(q);
  return start < 0 ? null : { start, end: start + q.length };
}

function entityGroups(results: readonly SearchResult[], kind: SearchEntityType | undefined): PaletteGroup[] {
  const byType = new Map<SearchEntityType, PaletteRow[]>();
  for (const hit of results) {
    const rows = byType.get(hit.type) ?? [];
    rows.push({
      key: `entity:${hit.type}:${hit.id}`,
      title: hit.title,
      ...(hit.subtitle ? { subtitle: hit.subtitle } : {}),
      icon: ENTITY_GROUPS[hit.type].icon,
      href: hit.href,
      ...(hit.status ? { status: hit.status } : {}),
    });
    byType.set(hit.type, rows);
  }
  const groups = [...byType].map(([type, rows]) => ({ key: `entity:${type}`, label: ENTITY_GROUPS[type].label, rows, type }));
  if (kind) groups.sort((a, b) => Number(b.type === kind) - Number(a.type === kind));
  return groups.map(({ key, label, rows }) => ({ key, label, rows }));
}

export function buildPalette(input: PaletteInput): PaletteGroup[] {
  const q = input.query.trim();
  const goTo: PaletteRow[] = NAV_DESTINATIONS.map((d) => ({ key: `nav:${d.id}`, title: d.label, icon: d.icon, href: d.path, command: d.command }));
  const actions: PaletteRow[] = input.actions.map((id) => ({
    key: `command:${id}`,
    title: ACTION_LABEL[id] ?? COMMANDS[id].label,
    icon: ACTION_ICONS[id] ?? 'plus',
    command: id,
    ...(id === 'theme.toggle' ? { hint: input.themeHint } : {}),
  }));
  const keywordsOf = (row: PaletteRow): readonly string[] => (row.command ? (KEYWORDS[row.command] ?? []) : []);
  const recentChats: PaletteRow[] = (input.recentChats ?? []).map((c) => ({
    key: `chat:${c.id}`,
    title: c.name,
    ...(c.projectName ? { subtitle: c.projectName } : {}),
    icon: 'chats',
    href: `/chats/${encodeURIComponent(c.id)}`,
    ...(c.live ? { status: c.live } : {}),
  }));
  const groups: PaletteGroup[] = [];
  const push = (key: string, label: string, rows: PaletteRow[], note?: string): void => {
    if (rows.length || note) groups.push({ key, label, rows, ...(note ? { note } : {}) });
  };

  if (input.offline) {
    push('actions', 'Actions', filterRows(q, actions, keywordsOf), 'Server offline · showing local actions');
    push('nav', 'Go to', filterRows(q, goTo, keywordsOf));
    return groups;
  }
  if (!q) {
    push('recent', 'Recent', (input.recents ?? []).map((r) => ({ ...r })));
    push('actions', 'Actions', actions);
    push('nav', 'Go to', goTo);
    push('chats', 'Recent chats', recentChats);
    return groups;
  }
  const seen = new Set<string>();
  for (const group of entityGroups(input.results ?? [], input.kind)) {
    for (const row of group.rows) seen.add(row.href ?? row.key);
    push(group.key, group.label, group.rows);
  }
  push('nav', 'Go to', filterRows(q, goTo, keywordsOf));
  push('actions', 'Actions', filterRows(q, actions, keywordsOf));
  push('chats', 'Recent chats', filterRows(q, recentChats).filter((r) => !seen.has(r.href ?? r.key)));
  return groups;
}

/** Every row in order (keyboard selection walks this list). */
export function flatRows(groups: readonly PaletteGroup[]): PaletteRow[] {
  return groups.flatMap((g) => g.rows);
}

/** Remember an opened row: newest first, no duplicates, at most `max`. */
export function rememberRecent(list: readonly RecentEntry[], entry: RecentEntry, max = 8): RecentEntry[] {
  return [entry, ...list.filter((e) => e.key !== entry.key)].slice(0, max);
}

export function parseRecents(raw: string | undefined): RecentEntry[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((e): e is RecentEntry => {
      const r = e as Partial<RecentEntry>;
      return typeof r?.key === 'string' && typeof r.title === 'string' && typeof r.href === 'string' && typeof r.icon === 'string' && r.href.startsWith('/');
    });
  } catch {
    return [];
  }
}

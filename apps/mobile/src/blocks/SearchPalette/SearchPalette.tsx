// MB-21 SearchPalette (03 MB-21; 06 §3.9; MSearch; MD-81): the full-screen search — the field is the header
// (ML-28). Local rows (Actions from the mobile command set, Go to from NAV_DESTINATIONS) and the per-server recents
// need no server; typed queries add the server's entity search (G-18, debounced 200 ms) and the recent chats with
// their live state. Touch and hardware keys both drive it: ↑ / ↓ move the selection, Return opens it, Escape
// closes (palette.* commands through the shell's command bus). Search hrefs pass the deep-link allowlist before they
// navigate (06 §6.6). Offline: Actions and Go to only, with a note.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { NAV_DESTINATIONS, deepLinkToRoute, type CommandId } from '@generatorai/shared/ui-contract';
import { SEARCH_ENTITY_TYPES, type SearchEntityType } from '@generatorai/shared';

import { useApi } from '../../services/api/useApi';
import { useAuth } from '../../services/auth/AuthProvider';
import { prefs } from '../../services/storage/prefs';
import { useStreamHealth } from '../../services/stream/streamHealth';
import { useTheme } from '../../theme/ThemeProvider';
import { ListSection } from '../../ui/layout/ListSection';
import { SearchHeader } from '../../ui/layout/SearchHeader';
import { useWindowInsets } from '../../ui/platform/insets';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { Pressable } from '../../ui/primitives/Pressable';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import { useAttentionLists } from '../AttentionList';
import { onScopedCommand } from '../shell/commandBus';
import { MOBILE_PALETTE_ACTIONS, useCommandRunner } from '../shell/commands';
import { goToModule } from '../shell/navigation';
import { themeToggleHint, type ThemeModeName } from '../shell/themeCycle';
import { ENTITY_GROUPS, buildPalette, flatRows, highlightRange, parseRecents, rememberRecent, type PaletteRow, type RecentChat } from './paletteModel';

const DEBOUNCE_MS = 200;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** `?kind=workflows` (the "Run workflow…" quick action) → that entity type first. */
export function kindParam(value: unknown): SearchEntityType | undefined {
  if (typeof value !== 'string') return undefined;
  const singular = value.replace(/s$/, '');
  return (SEARCH_ENTITY_TYPES as readonly string[]).includes(singular) ? (singular as SearchEntityType) : undefined;
}

function Highlighted({ text, query }: { text: string; query: string }): React.ReactElement {
  const range = highlightRange(query, text);
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range.start)}
      <Text role="body" weight={600} tone="fg">
        {text.slice(range.start, range.end)}
      </Text>
      {text.slice(range.end)}
    </>
  );
}

function PaletteRowView({ row, query, selected, onPress }: { row: PaletteRow; query: string; selected: boolean; onPress: () => void }): React.ReactElement {
  return (
    <Pressable
      testID={`search-row-${row.key}`}
      onPress={onPress}
      frame="none"
      accessibilityRole="button"
      accessibilityLabel={[row.title, row.subtitle, row.hint].filter(Boolean).join(', ')}
      accessibilityState={{ selected }}
      className={selected ? 'min-h-row flex-row items-center gap-3 bg-selected px-4' : 'min-h-row flex-row items-center gap-3 px-4'}
    >
      <Icon concept={row.icon} size={20} tone="fg-2" />
      <View className="min-w-0 flex-1 py-2">
        <Text role="body" tone="fg" numberOfLines={1}>
          <Highlighted text={row.title} query={query} />
        </Text>
        {row.subtitle ? (
          <Text role="monoSm" tone="fg-3" numberOfLines={1}>
            {row.subtitle}
          </Text>
        ) : null}
      </View>
      {row.status ? <StatusBadge state={row.status} size="sm" /> : row.hint ? <Text role="footnote" tone="fg-3" numberOfLines={1}>{row.hint}</Text> : null}
    </Pressable>
  );
}

export function SearchPalette(): React.ReactElement {
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind = kindParam(params.kind);
  const api = useApi();
  const { serverId } = useAuth();
  const { mode } = useTheme();
  const insets = useWindowInsets();
  const offline = useStreamHealth((s) => s.connection === 'offline');
  const runCommand = useCommandRunner();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);

  const recentsKey = `srv.${serverId ?? 'none'}.palette.recents`;
  const [recents, setRecents] = useState(() => {
    try {
      return parseRecents(prefs.getString(recentsKey));
    } catch {
      return [];
    }
  });

  const search = useQuery({
    queryKey: ['search', debounced, kind ?? 'all'],
    queryFn: () => api.search({ q: debounced, limit: 20, ...(kind ? { types: [kind] } : {}) }),
    enabled: debounced.length > 0 && !offline,
    staleTime: 15_000,
  });
  const chats = useQuery({
    queryKey: ['chats', 'palette-recent'],
    queryFn: () => api.chats.list({ sort: 'activity', status: 'active', limit: 5 }),
    enabled: !offline,
    staleTime: 30_000,
  });
  const { needsYou, running } = useAttentionLists();

  const recentChats = useMemo<RecentChat[]>(() => {
    const live = new Map<string, { state: 'needs_you' | 'running'; project?: string }>();
    for (const item of running) if (item.entity === 'chat') live.set(item.entityId, { state: 'running', ...(item.project ? { project: item.project.name } : {}) });
    for (const item of needsYou) if (item.entity === 'chat') live.set(item.entityId, { state: 'needs_you', ...(item.project ? { project: item.project.name } : {}) });
    return (chats.data?.items ?? []).map((c) => {
      const l = live.get(c.id);
      return { id: c.id, name: c.name || 'Untitled chat', ...(l?.project ? { projectName: l.project } : {}), ...(l ? { live: l.state } : {}) };
    });
  }, [chats.data, needsYou, running]);

  const groups = useMemo(
    () =>
      buildPalette({
        query,
        results: search.data?.results,
        recentChats,
        recents,
        offline,
        themeHint: themeToggleHint(mode as ThemeModeName),
        ...(kind ? { kind } : {}),
        actions: MOBILE_PALETTE_ACTIONS,
      }),
    [query, search.data, recentChats, recents, offline, mode, kind],
  );
  const rows = useMemo(() => flatRows(groups), [groups]);
  const [selected, setSelected] = useState(0);
  const [selectedFor, setSelectedFor] = useState(query);
  if (selectedFor !== query) {
    setSelectedFor(query);
    setSelected(0);
  }
  const current = Math.min(selected, Math.max(0, rows.length - 1));

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  const open = useCallback(
    (row: PaletteRow | undefined) => {
      if (!row) return;
      if (row.href) {
        const next = rememberRecent(recents, { key: row.key, title: row.title, ...(row.subtitle ? { subtitle: row.subtitle } : {}), icon: row.icon, href: row.href });
        setRecents(next);
        try {
          prefs.setString(recentsKey, JSON.stringify(next));
        } catch {
          // Recents are a convenience.
        }
      }
      const destination = NAV_DESTINATIONS.find((d) => d.path === row.href);
      if (destination) {
        goToModule(destination.path);
        return;
      }
      if (row.command && !row.href) {
        close();
        requestAnimationFrame(() => runCommand(row.command as CommandId));
        return;
      }
      const safe = row.href ? deepLinkToRoute(row.href) : null;
      if (!safe) return;
      close();
      requestAnimationFrame(() => router.push(safe as never));
    },
    [recents, recentsKey, close, runCommand],
  );

  // Hardware keys: ↑ / ↓ / Return / Escape (palette.* commands, 06 §3.10).
  useEffect(
    () =>
      onScopedCommand((id) => {
        if (id === 'palette.next') setSelected((i) => Math.min(rows.length - 1, Math.min(i, rows.length - 1) + 1));
        else if (id === 'palette.prev') setSelected((i) => Math.max(0, Math.min(i, rows.length - 1) - 1));
        else if (id === 'palette.open') open(rows[current]);
        else if (id === 'palette.close' || id === 'dock.dismiss' || id === 'palette.toggle') close();
        else return false;
        return true;
      }),
    [rows, current, open, close],
  );

  const q = query.trim();
  const searching = q.length > 0 && !offline && (search.isFetching || debounced !== q) && !search.data;
  const placeholder = kind ? `Search ${ENTITY_GROUPS[kind].label.toLowerCase()}` : 'Search chats, runs, commands';
  return (
    <View testID="search-palette" className="flex-1 bg-surface">
      <SearchHeader
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder}
        onClose={close}
        onSubmit={() => open(rows[current])}
        {...(q ? { resultCount: rows.length } : {})}
        loading={search.isFetching}
      />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerClassName="gap-2" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {searching ? (
          <View className="pt-3" accessibilityLabel="Searching" accessibilityState={{ busy: true }}>
            <Skeleton preset="list" count={3} />
          </View>
        ) : null}
        {search.isError && q ? <ErrorState inline title="Couldn't search the server" error={search.error} onRetry={() => void search.refetch()} /> : null}
        {groups.map((group) => {
          const offset = rows.indexOf(group.rows[0]!);
          return (
            <ListSection key={group.key} title={group.label} {...(group.note ? { footer: group.note } : {})} dividers="none" testID={`search-group-${group.key}`}>
              {group.rows.map((row, i) => (
                <PaletteRowView key={row.key} row={row} query={q} selected={Boolean(q) && offset + i === current} onPress={() => open(row)} />
              ))}
            </ListSection>
          );
        })}
        {q && !searching && rows.length === 0 ? <EmptyState copyKey="searchResults" /> : null}
      </ScrollView>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// /search — find any chat, run, workflow, project, automation or agent.
//
// The phone's answer to the web command palette. Opened from the search
// icon in every tab header; the field is focused on arrival so typing starts
// immediately. Results come from the same React Query caches the tabs fill
// (so a warm app answers instantly) and every source is fetched on open if
// it is cold or stale. Ranking is `searchModel.ts` (pure, tested).
//
// Empty query → recent searches (MMKV, this device only). A recent is saved
// when a result is opened or the query is submitted, not per keystroke.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { SectionList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Clock, Search as SearchIcon, X } from 'lucide-react-native';
import {
  queryKeys,
  type AgentSummary,
  type AutomationSummary,
  type ChatSummary,
  type ProjectSummary,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from '@generatorai/client-core';

import { useApi } from '../src/api/useApi';
import { SearchResultRow } from '../src/components/search/SearchResultRow';
import {
  RECENT_SEARCHES_KEY,
  buildSearchIndex,
  parseRecentSearches,
  pushRecentSearch,
  rankSearch,
  removeRecentSearch,
  type SearchItem,
} from '../src/components/search/searchModel';
import { AgentDetailSheet } from '../src/components/work/AgentDetailSheet';
import { Button, IconButton } from '../src/components/ui/Button';
import { SearchField } from '../src/components/ui/Form';
import { ListSectionHeader } from '../src/components/ui/ListItem';
import { goBack } from '../src/components/ui/Screen';
import { SkeletonList } from '../src/components/ui/Skeleton';
import { EmptyState } from '../src/components/ui/States';
import { Touchable } from '../src/components/ui/Touchable';
import { chatRoute, runRoute } from '../src/navigation/routes';
import { prefs } from '../src/storage/prefs';
import { useTheme } from '../src/theme/ThemeProvider';

/** Warm caches are used as-is for this long before a background refetch. */
const STALE_MS = 30_000;

function readRecents(): string[] {
  try {
    return parseRecentSearches(prefs.getString(RECENT_SEARCHES_KEY));
  } catch {
    return [];
  }
}

function writeRecents(list: string[]): void {
  try {
    if (list.length === 0) prefs.delete(RECENT_SEARCHES_KEY);
    else prefs.setString(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // Recents are a convenience; never fail a search over them.
  }
}

function hrefFor(item: SearchItem): string | null {
  switch (item.kind) {
    case 'chat':
      return chatRoute(item.id);
    case 'run':
      return runRoute(item.id);
    case 'workflow':
      return `/workflows/${encodeURIComponent(item.id)}`;
    case 'project':
      return `/projects/${encodeURIComponent(item.id)}`;
    case 'automation':
      return `/automations/${encodeURIComponent(item.id)}`;
    case 'agent':
      return null; // opens the agent sheet in place
  }
}

export default function SearchScreen(): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [recents, setRecents] = useState<string[]>(readRecents);
  const [agent, setAgent] = useState<AgentSummary | null>(null);

  // Same keys and fetchers as the tabs, so this reads their caches.
  const [chats, runs, workflows, projects, automations, agents] = useQueries({
    queries: [
      { queryKey: queryKeys.chats(), queryFn: () => api.chats.list({ limit: 50 }), staleTime: STALE_MS },
      { queryKey: queryKeys.runs(), queryFn: () => api.runs.list(), staleTime: STALE_MS },
      { queryKey: queryKeys.workflows(), queryFn: () => api.workflows.list(), staleTime: STALE_MS },
      { queryKey: queryKeys.projects(), queryFn: () => api.projects.list(), staleTime: STALE_MS },
      { queryKey: queryKeys.automations(), queryFn: () => api.automations.list(), staleTime: STALE_MS },
      { queryKey: ['agents', 'all'] as const, queryFn: () => api.agents.list(), staleTime: STALE_MS },
    ],
  });
  const sources = [chats, runs, workflows, projects, automations, agents];
  // `isPending`, not `isLoading`: a query that has not started fetching yet
  // (React Query waits for the network manager on a cold open) is pending but
  // not "loading", and the screen flashed "No matches" for a query that then
  // matched three items a second later.
  const loading = sources.some((s) => s.isPending && !s.isError);
  const failed = sources.filter((s) => s.isError).length;

  const index = useMemo(
    () =>
      buildSearchIndex({
        chats: chats.data as ChatSummary[] | undefined,
        runs: runs.data as WorkflowRunSummary[] | undefined,
        workflows: workflows.data as WorkflowSummary[] | undefined,
        projects: projects.data as ProjectSummary[] | undefined,
        automations: automations.data as AutomationSummary[] | undefined,
        agents: agents.data as AgentSummary[] | undefined,
      }),
    [chats.data, runs.data, workflows.data, projects.data, automations.data, agents.data],
  );

  const sections = useMemo(
    () =>
      rankSearch(index, deferred).map((section) => ({
        key: section.kind,
        title: section.title,
        total: section.total,
        data: section.items,
      })),
    [index, deferred],
  );

  const remember = useCallback((q: string) => {
    setRecents((prev) => {
      const next = pushRecentSearch(prev, q);
      writeRecents(next);
      return next;
    });
  }, []);

  const forget = useCallback((q: string) => {
    setRecents((prev) => {
      const next = removeRecentSearch(prev, q);
      writeRecents(next);
      return next;
    });
  }, []);

  const clearRecents = useCallback(() => {
    setRecents([]);
    writeRecents([]);
  }, []);

  const open = useCallback(
    (item: SearchItem) => {
      remember(query);
      if (item.kind === 'agent') {
        setAgent(item.raw);
        return;
      }
      const href = hrefFor(item);
      if (href) router.push(href as never);
    },
    [query, remember],
  );

  const trimmed = query.trim();
  const showRecents = trimmed.length === 0;

  let body: React.ReactElement | null = null;
  if (showRecents) {
    body =
      recents.length === 0 ? (
        <EmptyState
          title="Search everything"
          message="Chats, runs, workflows, projects, automations and agents."
          icon={<SearchIcon size={24} color={colors['muted-foreground']} />}
        />
      ) : (
        <View>
          <ListSectionHeader
            label="Recent searches"
            action={<Button label="Clear" variant="ghost" size="sm" haptic="tap" onPress={clearRecents} />}
          />
          {recents.map((recent) => (
            <View key={recent} className="flex-row items-center">
              <Touchable
                accessibilityLabel={`Search for ${recent}`}
                haptic="tap"
                scale="none"
                onPress={() => setQuery(recent)}
                className="min-h-12 flex-1 flex-row items-center gap-3 pl-4"
              >
                <Clock size={16} color={colors['muted-foreground']} />
                <Text numberOfLines={1} className="flex-1 text-md text-foreground">
                  {recent}
                </Text>
              </Touchable>
              <IconButton
                accessibilityLabel={`Remove ${recent} from recent searches`}
                icon={<X size={16} color={colors['muted-foreground']} />}
                onPress={() => forget(recent)}
              />
            </View>
          ))}
        </View>
      );
  } else if (sections.length === 0) {
    // Also while the deferred query is still catching up with what was typed.
    body = loading || deferred.trim() !== trimmed ? (
      <SkeletonList rows={5} variant="flat" />
    ) : (
      <EmptyState title="No matches" message={`Nothing matches “${trimmed}”.`} />
    );
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-1 pb-2 pl-1 pr-4 pt-2">
        <IconButton
          accessibilityLabel="Back"
          icon={<ChevronLeft size={24} color={colors.foreground} />}
          onPress={() => goBack('/(tabs)')}
        />
        <View className="flex-1">
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search chats, runs, agents…"
            accessibilityLabel="Search everything"
            autoFocus
            onSubmit={() => remember(query)}
          />
        </View>
      </View>

      <SectionList
        sections={showRecents ? [] : sections}
        keyExtractor={(item) => `${item.kind}:${item.id}`}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        renderSectionHeader={({ section }) => (
          <ListSectionHeader
            label={section.title}
            {...(section.total > section.data.length ? { count: section.total } : {})}
          />
        )}
        renderItem={({ item, index: i, section }) => (
          <SearchResultRow item={item} onPress={open} separator={i < section.data.length - 1} />
        )}
        ListHeaderComponent={body}
        ListFooterComponent={
          !showRecents && failed > 0 ? (
            <View className="gap-2 px-4 pt-4">
              <Text className="text-sm text-muted-foreground">Some results could not be loaded.</Text>
              <Button
                label="Try again"
                variant="secondary"
                size="sm"
                onPress={() => {
                  for (const source of sources) if (source.isError) void source.refetch();
                }}
              />
            </View>
          ) : null
        }
      />

      <AgentDetailSheet agent={agent} onClose={() => setAgent(null)} />
    </View>
  );
}

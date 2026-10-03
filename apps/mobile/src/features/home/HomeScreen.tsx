// Home (MHome, MHomeMore; 04 §2.1; M7-01): the date and the connection under the title; three count tiles (Need you,
// Running, Finished today — each scrolls to its section); Needs you (live attention, five rows + "See all"; a row
// never answers inline — a chat permission or question opens the approval sheet, which signs risky approvals, MD-21 /
// MD-31); Running (hidden at 0, ticking timers); Recently finished (outcome, PR / commit from MG-13, finish time);
// "This week" (MB-40, ISO week MD-84; absent rates are omitted); the server footer (→ server switcher). NewAction
// "New chat" (`home-new-chat`).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, type LayoutChangeEvent, type ScrollView } from 'react-native';
import { router } from 'expo-router';
import { attentionItemRoute } from '@generatorai/client-core';
import type { AttentionItem, RecentActivityItem } from '@generatorai/shared';

import { useOpenAttentionItem } from '../../blocks/AttentionList';
import { useConnectionHealth } from '../../blocks/ConnectionStatus';
import { NEEDS_YOU_HREF, NEW_CHAT_HREF, SERVERS_HREF } from '../../blocks/shell/hrefs';
import { openSearch } from '../../blocks/shell/navigation';
import { useSidebarToggle } from '../../blocks/shell/useSidebarToggle';
import { ServerFooterLink, WeekStatsStrip } from '../../blocks/StatsCards';
import { weekRange } from './weekRange';
import { useAuth } from '../../services/auth/AuthProvider';
import { mobileRoute } from '../../services/navigation/mobileRoutes';
import { EntityRow } from '../../ui/layout/EntityRow';
import { ListSection } from '../../ui/layout/ListSection';
import { NewAction } from '../../ui/layout/NewAction';
import { Screen } from '../../ui/layout/Screen';
import { SectionHeader } from '../../ui/layout/SectionHeader';
import { StatStrip } from '../../ui/layout/StatStrip';
import { formatCount, formatElapsed } from '../../ui/lib/format';
import { projectLabelRole } from '../../ui/lib/projectLabel';
import { Header } from '../../ui/native/router/Header';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { HEALTH } from '@generatorai/shared';
import { HOME_NEEDS_LIMIT, finishTime, homeDate, needsYouAction, needsYouMeta, recentRowView, runningMeta } from './homeModel';
import { useHomeData } from './queries';

type SectionId = 'needs' | 'running' | 'recent';

/** One-second clock for the Running timers; idle when nothing runs. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** "Wed, Sep 23 · ● Connected local:3100" (MB-43 subtitle form). */
function HomeSubtitle(): React.ReactElement {
  const { health, address } = useConnectionHealth();
  const word = health === 'reconnecting' ? `${HEALTH.connection.reconnecting.label}…` : HEALTH.connection[health].label;
  return (
    <View className="flex-row flex-wrap items-center gap-x-1.5" accessible accessibilityLabel={[homeDate(), word, address].filter(Boolean).join(', ')} testID="home-subtitle">
      <Text role="footnote" tone="fg-2">
        {homeDate()} ·
      </Text>
      <StatusDot health={HEALTH.connection[health].tone} size="sm" />
      <Text role="footnote" tone="fg-2">
        {word}
      </Text>
      {address ? (
        <Text role="monoSm" tone="fg-3" numberOfLines={1}>
          {address}
        </Text>
      ) : null}
    </View>
  );
}

function useOpenHref(): (href: string) => void {
  const { serverId } = useAuth();
  return useCallback(
    (href: string) => {
      const route = serverId ? attentionItemRoute({ href }, serverId) : null;
      const pathname = route ? mobileRoute(route.pathname) : null;
      if (route && pathname) router.push({ pathname: pathname as never, params: route.params });
    },
    [serverId],
  );
}

function NeedsYouRow({ item, position }: { item: AttentionItem; position: 'first' | 'middle' | 'last' | 'only' }): React.ReactElement {
  const openItem = useOpenAttentionItem();
  const action = needsYouAction(item);
  const open = (): void => {
    if (action.sheetHref) router.push(action.sheetHref as never);
    else openItem(item);
  };
  return (
    <EntityRow
      title={item.title}
      leading={{ status: 'needs_you' }}
      meta={needsYouMeta(item)}
      trailing={<Button label={action.label} size="sm" variant="tonal" onPress={open} accessibilityLabel={`${action.label} ${item.title}`} testID={`home-needs-action-${item.key}`} />}
      onPress={open}
      position={position}
      testID={`home-needs-${item.key}`}
    />
  );
}

function RunningRow({ item, now, position }: { item: AttentionItem; now: number; position: 'first' | 'middle' | 'last' | 'only' }): React.ReactElement {
  const openItem = useOpenAttentionItem();
  const meta = runningMeta(item);
  const elapsed = formatElapsed(Math.max(0, now - Date.parse(item.since)));
  return (
    <EntityRow
      title={item.title}
      leading={{ status: 'running' }}
      meta={[
        ...(meta.project
          ? [
              <Text key="p" role={projectLabelRole(meta.project)} tone="fg-3" numberOfLines={1} className="shrink">
                {meta.project}
              </Text>,
            ]
          : []),
        ...(meta.detail ? [meta.detail] : []),
      ]}
      metaLabel={[meta.project, meta.detail].filter(Boolean).join(', ')}
      trailing={
        <Text role="monoSm" tone="run" tabular>
          {elapsed}
        </Text>
      }
      onPress={() => openItem(item)}
      position={position}
      testID={`home-running-${item.key}`}
    />
  );
}

function RecentRow({ item, position, onOpen }: { item: RecentActivityItem; position: 'first' | 'middle' | 'last' | 'only'; onOpen: (href: string) => void }): React.ReactElement {
  const view = recentRowView(item);
  return (
    <EntityRow
      title={view.title}
      leading={{ status: view.state }}
      meta={[
        ...(view.project
          ? [
              <Text key="p" role={projectLabelRole(view.project)} tone="fg-3" numberOfLines={1} className="shrink">
                {view.project}
              </Text>,
            ]
          : []),
        <Text key="o" role="footnote" tone={view.outcomeTone} numberOfLines={1}>
          {view.outcome}
        </Text>,
      ]}
      metaLabel={[view.project, view.outcome].filter(Boolean).join(', ')}
      trailing={
        <Text role="footnote" tone="fg-3" tabular>
          {finishTime(view.endedAt)}
        </Text>
      }
      onPress={() => onOpen(item.href)}
      position={position}
      testID={`home-recent-${item.key}`}
    />
  );
}

function positionOf(index: number, count: number): 'first' | 'middle' | 'last' | 'only' {
  if (count === 1) return 'only';
  if (index === 0) return 'first';
  return index === count - 1 ? 'last' : 'middle';
}

export default function HomeScreen(): React.ReactElement {
  const sidebar = useSidebarToggle();
  const data = useHomeData();
  const openHref = useOpenHref();
  const now = useNow(data.running.length > 0);
  const scrollRef = useRef<ScrollView | null>(null);
  const sections = useRef<Partial<Record<SectionId, number>>>({});
  const onNeedsLayout = useCallback((e: LayoutChangeEvent) => {
    sections.current.needs = e.nativeEvent.layout.y;
  }, []);
  const onRunningLayout = useCallback((e: LayoutChangeEvent) => {
    sections.current.running = e.nativeEvent.layout.y;
  }, []);
  const onRecentLayout = useCallback((e: LayoutChangeEvent) => {
    sections.current.recent = e.nativeEvent.layout.y;
  }, []);
  const scrollTo = useCallback((id: SectionId): void => {
    const y = sections.current[id];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  }, []);

  const needs = data.needsYou.slice(0, HOME_NEEDS_LIMIT);
  const recent = data.recent;
  const loading = !data.attentionLoaded && !data.attentionError;

  const header = (
    <Header
      role="top"
      title="Home"
      largeTitle
      subtitle={<HomeSubtitle />}
      onSidebarToggle={sidebar.onSidebarToggle}
      sidebarToggleState={sidebar.sidebarToggleState}
      actions={[{ id: 'search', icon: 'search', label: 'Search', onPress: () => openSearch(), testID: 'header-search' }]}
    />
  );

  return (
    <Screen
      header={header}
      scrollRef={scrollRef}
      onRefresh={data.refetch}
      bottomAccessory={<NewAction label="New chat" icon="edit" onPress={() => router.push(NEW_CHAT_HREF as never)} testID="home-new-chat" />}
      testID="home"
    >
      <View className="gap-6 px-4 pb-6 pt-2">
        <StatStrip
          variant="tiles"
          testID="home-counts"
          items={[
            { id: 'needs', value: data.attentionLoaded ? data.needsYou.length : null, label: 'Need you', tone: data.needsYou.length > 0 ? 'warn' : 'fg', onPress: () => scrollTo('needs') },
            { id: 'running', value: data.attentionLoaded ? data.running.length : null, label: 'Running', tone: data.running.length > 0 ? 'run' : 'fg', onPress: () => scrollTo('running') },
            {
              id: 'finished',
              value: data.finishedToday === null ? null : data.finishedTodayCapped ? formatCount(data.finishedToday, 99) : data.finishedToday,
              label: 'Finished today',
              onPress: () => scrollTo('recent'),
            },
          ]}
        />

        <View className="gap-2" onLayout={onNeedsLayout} testID="home-needs">
          <SectionHeader
            variant="home"
            title="Needs you"
            {...(data.needsYou.length > HOME_NEEDS_LIMIT ? { action: { label: 'See all', onPress: () => router.push(NEEDS_YOU_HREF as never) } } : {})}
          />
          {loading ? (
            <Skeleton preset="list" count={3} />
          ) : data.attentionError && !data.attentionLoaded ? (
            <ErrorState title="Couldn't load what needs you" error={data.attentionError} onRetry={() => void data.refetch()} />
          ) : needs.length === 0 ? (
            <EmptyState copyKey="needsYou" compact />
          ) : (
            <ListSection>
              {needs.map((item, i) => (
                <NeedsYouRow key={item.key} item={item} position={positionOf(i, needs.length)} />
              ))}
            </ListSection>
          )}
        </View>

        {data.running.length > 0 ? (
          <View className="gap-2" onLayout={onRunningLayout} testID="home-running">
            <SectionHeader variant="home" title="Running" />
            <ListSection>
              {data.running.map((item, i) => (
                <RunningRow key={item.key} item={item} now={now} position={positionOf(i, data.running.length)} />
              ))}
            </ListSection>
          </View>
        ) : null}

        <View className="gap-2" onLayout={onRecentLayout} testID="home-recent">
          <SectionHeader variant="home" title="Recently finished" />
          {!data.recentLoaded && !data.recentError ? (
            <Skeleton preset="list" count={3} />
          ) : data.recentError && recent.length === 0 ? (
            <ErrorState title="Couldn't load recent work" error={data.recentError} onRetry={() => void data.refetch()} />
          ) : recent.length === 0 ? (
            <EmptyState copyKey="recentlyFinished" compact />
          ) : (
            <ListSection>
              {recent.map((item, i) => (
                <RecentRow key={item.key} item={item} position={positionOf(i, recent.length)} onOpen={openHref} />
              ))}
            </ListSection>
          )}
        </View>

        <View className="gap-2">
          <SectionHeader variant="home" title="This week" />
          <WeekStatsStrip range={weekRange()} />
        </View>

        <ServerFooterLink onPress={() => router.push(SERVERS_HREF as never)} />
      </View>
    </Screen>
  );
}

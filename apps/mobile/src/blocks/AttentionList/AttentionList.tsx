// MB-19 AttentionList (03 MB-19; MSidebar, MD-34): the live Needs you / Running lists from the attention store of the
// active server (MD-05). `drawer` renders the two sidebar sections (hidden when empty; "Show all (N)" past five),
// `list` the full Needs you screen. Rows open their item through `attentionItemRoute`, which validates the server's
// web-shaped href and pins the server id; `?dock=` survives (R-4).
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { attentionItemRoute, selectNeedsYou, selectRunning } from '@generatorai/client-core';
import type { AttentionItem } from '@generatorai/shared';

import { useAuth } from '../../services/auth/AuthProvider';
import { mobileRoute } from '../../services/navigation/mobileRoutes';
import { useAttention } from '../../services/stream/AttentionProvider';
import { DrawerLiveRow, DrawerSection } from '../../ui/layout/Drawer';
import { EntityRow } from '../../ui/layout/EntityRow';
import { ListSection } from '../../ui/layout/ListSection';
import { formatElapsed } from '../../ui/lib/format';
import { NEEDS_YOU_HREF } from '../shell/hrefs';
import { askHint, attentionLabel, sectionRows } from './attentionModel';

export interface AttentionListProps {
  variant: 'drawer' | 'list';
  /** Called after a row navigates (the drawer closes itself). */
  onNavigate?: () => void;
  /** Ticking elapsed times only while visible. */
  active?: boolean;
}

/** One-second clock for running rows; paused while the list is off screen. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function useAttentionLists(): { needsYou: readonly AttentionItem[]; running: readonly AttentionItem[]; loaded: boolean } {
  const attention = useAttention();
  return { needsYou: selectNeedsYou(attention), running: selectRunning(attention), loaded: attention.snapshot !== null };
}

export function useOpenAttentionItem(onNavigate?: () => void): (item: AttentionItem) => void {
  const { serverId } = useAuth();
  return (item) => {
    const route = serverId ? attentionItemRoute(item, serverId) : null;
    // The server's web-shaped href, mapped onto the mobile tree (screens that land later open their nearest parent).
    const pathname = route ? mobileRoute(route.pathname) : null;
    onNavigate?.();
    if (route && pathname) router.push({ pathname: pathname as never, params: route.params });
  };
}

export function AttentionList({ variant, onNavigate, active = true }: AttentionListProps): React.ReactElement | null {
  const { needsYou, running } = useAttentionLists();
  const now = useNow(active && running.length > 0);
  const open = useOpenAttentionItem(onNavigate);
  const elapsed = (item: AttentionItem): string => formatElapsed(Math.max(0, now - Date.parse(item.since)));

  if (variant === 'list') {
    if (needsYou.length === 0) return null;
    return (
      <ListSection testID="needs-you-list">
        {needsYou.map((item) => (
          <EntityRow
            key={item.key}
            title={item.title}
            leading={{ status: 'needs_you' }}
            meta={[item.ask?.summary ?? askHint(item) ?? '', ...(item.project ? [item.project.name] : [])].filter(Boolean)}
            time={item.since}
            onPress={() => open(item)}
            testID={`needs-you-${item.key}`}
          />
        ))}
      </ListSection>
    );
  }

  const needs = sectionRows(needsYou);
  const live = sectionRows(running);
  if (needs.total === 0 && live.total === 0) return null;
  return (
    <View>
      {needs.total > 0 ? (
        <DrawerSection
          label="Needs you"
          count={needs.total}
          countTone="warn"
          testID="drawer-inbox"
          showAll={needs.overflow ? { label: `Show all (${needs.total})`, onPress: () => { onNavigate?.(); router.push(NEEDS_YOU_HREF); } } : undefined}
        >
          {needs.rows.map((item) => (
            <DrawerLiveRow key={item.key} kind="needs-you" title={item.title} trailing={askHint(item)} accessibilityLabel={attentionLabel(item)} onPress={() => open(item)} />
          ))}
        </DrawerSection>
      ) : null}
      {live.total > 0 ? (
        <DrawerSection
          label="Running"
          count={live.total}
          showAll={live.overflow ? { label: `Show all (${live.total})`, onPress: () => { onNavigate?.(); router.push('/'); } } : undefined}
        >
          {live.rows.map((item) => (
            <DrawerLiveRow key={item.key} kind="running" title={item.title} trailing={elapsed(item)} trailingMono accessibilityLabel={attentionLabel(item, elapsed(item))} onPress={() => open(item)} />
          ))}
        </DrawerSection>
      ) : null}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────
// HomePage (P5-10; L-01 Dashboard; board Home; 04-screen-map §2.1 Home and
// the §4.2 parity checklist) — `/`, replacing the Dashboard "Mission Control".
//
//   header    PageHeader "Home"
//   greeting  date line + H1 "2 need you · 3 running" (attention counts)
//   start     QuickActions (D-134, replaces the F-home-02 quick composer):
//             New chat (the dialog) · Run workflow (→ /workflows, where each
//             workflow runs) · New workflow · New agent
//   sections  Needs you · Running (G-01) · Recently finished (G-11)
//   aside     This week (G-10) · System (G-12) · shortcut counts
//
// Below 1200px window width the aside stacks under the main column.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAttention } from '@/hooks/attentionQueries.js';
import { RAIL_QUERY, useMediaQuery } from '@/hooks/useMediaQuery.js';
import { useNow } from '@/lib/elapsed.js';
import { Dashboard } from '@/ui/templates/Dashboard/Dashboard.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { QuickActions, type QuickAction } from '@/ui/patterns/QuickActions/QuickActions.js';
import { shortcutFor } from '@/lib/shortcuts.js';
import { useNewChatStore } from '@/stores/newChatStore.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { formatDateLine, homeHeadline } from './homeModel.js';
import { NeedsYouSection, RecentlyFinishedSection, RunningSection } from './HomeSections.js';
import { ShortcutsCard, SystemCard, ThisWeekCard } from './HomeAside.js';

/**
 * A counter that ticks whenever an attention item leaves the feed — something
 * finished or was answered — so the finished list and the week's numbers refetch
 * (G-11/G-10 have no stream of their own).
 */
function useFinishedSignal(keys: readonly string[] | undefined): number {
  const [signal, setSignal] = useState(0);
  const previous = useRef<ReadonlySet<string> | null>(null);
  const joined = keys?.join('\n');
  useEffect(() => {
    if (joined === undefined) return;
    const current = new Set(joined ? joined.split('\n') : []);
    const before = previous.current;
    previous.current = current;
    if (before && [...before].some((key) => !current.has(key))) setSignal((n) => n + 1);
  }, [joined]);
  return signal;
}

export function HomePage() {
  const navigate = useNavigate();
  const attention = useAttention();
  const stacked = useMediaQuery(RAIL_QUERY);
  const now = useNow(true, 60_000);
  const data = attention.data;
  const finishedSignal = useFinishedSignal(data ? [...data.needsYou, ...data.running].map((i) => i.key) : undefined);
  const headline = homeHeadline(data?.counts);
  const openNewChat = useNewChatStore((st) => st.open);

  const startActions: QuickAction[] = [
    {
      id: 'new-chat',
      icon: 'chats',
      title: 'New chat',
      description: 'Ask an agent to work on something',
      shortcut: shortcutFor('chat.new'),
      onSelect: () => openNewChat(),
    },
    {
      id: 'run-workflow',
      icon: 'play',
      title: 'Run workflow',
      description: 'Pick a saved workflow and run it',
      onSelect: () => navigate('/workflows'),
    },
    {
      id: 'new-workflow',
      icon: 'workflows',
      title: 'New workflow',
      description: 'Chain agents into reviewed stages',
      shortcut: shortcutFor('workflow.new'),
      onSelect: () => navigate('/workflows/new'),
    },
    {
      id: 'new-agent',
      icon: 'agents',
      title: 'New agent',
      description: 'Reusable instructions, skills and tools',
      onSelect: () => navigate('/agents/new'),
    },
  ];

  return (
    <Dashboard
      data-testid="home-page"
      asideStacked={stacked}
      header={
        <PageHeader title="Home" />
      }
      dateLine={formatDateLine(new Date(now))}
      greeting={<h1 className="text-display">{headline ?? 'Home'}</h1>}
      start={<QuickActions label="Start" actions={startActions} />}
      sections={
        <>
          {data ? (
            <>
              <NeedsYouSection items={data.needsYou} />
              <RunningSection items={data.running} />
            </>
          ) : attention.error ? (
            <Callout
              tone="err"
              title="Could not load what needs you"
              action={
                <Button size="sm" onClick={() => void attention.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : (
            <SkeletonRows rows={2} label="Loading activity" />
          )}
          <RecentlyFinishedSection finishedSignal={finishedSignal} />
        </>
      }
      aside={
        <>
          <ThisWeekCard finishedSignal={finishedSignal} />
          <SystemCard />
          <ShortcutsCard />
        </>
      }
    />
  );
}

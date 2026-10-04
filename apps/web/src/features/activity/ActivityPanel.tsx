// ────────────────────────────────────────────────────────────────
// ActivityPanel (D-92; boards EnhActivityColumn, EnhSidebarHidden) — the
// Activity column's content, docked between the sidebar/rail and the main
// card, or as an overlay over the card in a narrow window (app/shell picks).
//
//   header   "Activity" + needs you / running / failed badges · filter menu
//            (Show finished) · Hide
//   tabs     All / Chats / Orchestrators / Workflows / Automations with counts
//   groups   Needs you → Failed → Running → Recent (today)
// The board's server filter is not drawn: the feed is the connected server's
// only — there is no multi-server data to filter (D-36, D-92).
//
// Keyboard: one card is in the tab order (roving); ↑/↓/Home/End move, Enter
// opens, → opens the popover's actions, Esc closes the popover, then the
// column (focus returns to the toggle). Opening the column by its command or
// toggle moves focus to the open page's card (else the first); a column
// restored open at launch leaves focus alone.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { activityMatchesPath, flattenActivity, type ActivityEntry } from '@generatorai/client-core';
import {
  ACTIVITY_COPY,
  ACTIVITY_GROUP_LABELS,
  ACTIVITY_GROUPS,
  ACTIVITY_KIND_META,
  ACTIVITY_KINDS,
  type ActivityGroup as ActivityGroupId,
} from '@generatorai/shared/ui-contract';
import type { IconConcept } from '@generatorai/design-tokens';
import { shortcutFor } from '@/hooks/useShellStatus.js';
import { useNow } from '@/lib/elapsed.js';
import { useActivityStore, type ActivityKindFilter } from '@/stores/activityStore.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { ActivityColumnHeader, ActivityCountBadge, ActivityGroup } from '@/ui/shell/ActivityColumn/ActivityColumn.js';
import { ActivityItem } from './ActivityItem.js';
import { useActivityModel } from './useActivityModel.js';

export interface ActivityPanelProps {
  /** Hide the column (the header's close, Esc). */
  onClose: () => void;
  /** After a card navigates: the overlay column closes itself. */
  onNavigate?: () => void;
}

/** The last open request a panel acted on (module-wide: the panel mounts because of the request). */
let lastFocusRequest = 0;

/** The header + tabs + groups; ActivityColumn (ui/shell) is the frame around them. */
export function useActivityPanel({ onClose, onNavigate }: ActivityPanelProps) {
  const { model, error, retry, modelLabel, finishedLoading } = useActivityModel();
  const kind = useActivityStore((s) => s.kind);
  const setKind = useActivityStore((s) => s.setKind);
  const showRecent = useActivityStore((s) => s.showRecent);
  const setShowRecent = useActivityStore((s) => s.setShowRecent);
  const { pathname } = useLocation();
  const entries = useMemo(() => (model ? flattenActivity(model) : []), [model]);
  const live = entries.some((e) => e.group === 'running' || e.group === 'needs_you');
  const now = useNow(live, 1000);
  const minuteNow = useNow(!live && entries.length > 0, 30_000);

  // ── Roving focus ──
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const selectedKey = entries.find((e) => activityMatchesPath(e, pathname))?.key ?? null;
  const rovingKey = activeKey && entries.some((e) => e.key === activeKey) ? activeKey : (selectedKey ?? entries[0]?.key ?? null);

  const focusKey = useCallback((key: string | undefined) => {
    if (!key) return;
    setActiveKey(key);
    links.current.get(key)?.focus();
  }, []);

  // Opened by the person (toggle, command): focus the open page's card, else the first.
  const focusRequest = useActivityStore((s) => s.focusRequest);
  useEffect(() => {
    if (focusRequest <= lastFocusRequest || !model) return;
    lastFocusRequest = focusRequest;
    const key = selectedKey ?? entries[0]?.key;
    requestAnimationFrame(() => {
      if (key) links.current.get(key)?.focus();
      else document.querySelector<HTMLElement>('[data-testid="activity-column"] [role="tab"], [data-testid="activity-close"]')?.focus();
    });
  }, [focusRequest, model, selectedKey, entries]);

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.target instanceof HTMLAnchorElement) || !e.target.closest('[data-testid="activity-card"]')) return;
    const index = entries.findIndex((entry) => entry.key === rovingKey);
    const move = (i: number) => {
      e.preventDefault();
      focusKey(entries[Math.max(0, Math.min(entries.length - 1, i))]?.key);
    };
    if (e.key === 'ArrowDown') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(entries.length - 1);
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // Inside a popover or menu (portaled, but its events bubble through React): it closes itself and
    // hands focus back to its card.
    if (e.target instanceof Element && e.target.closest('[data-gai-overlay]')) return;
    if (useActivityStore.getState().preview) {
      useActivityStore.getState().setPreview(null);
      e.preventDefault();
      return;
    }
    e.preventDefault();
    onClose();
  };

  // ── Header ──
  const header = (
    <ActivityColumnHeader
      badges={
        model ? (
          <span className="flex items-center gap-1" data-testid="activity-badges">
            {model.header.needsYou > 0 ? <ActivityCountBadge tone="warn" count={model.header.needsYou} label={`${model.header.needsYou} need you`} /> : null}
            {model.header.running > 0 ? <ActivityCountBadge tone="run" count={model.header.running} label={`${model.header.running} running`} /> : null}
            {model.header.failed > 0 ? <ActivityCountBadge tone="err" count={model.header.failed} label={`${model.header.failed} failed`} /> : null}
          </span>
        ) : null
      }
      actions={
        <>
          <Menu.Root>
            <Menu.Trigger render={<IconButton icon="filter" label="Filter activity" size="sm" data-testid="activity-filter" />} />
            <Menu.Popup align="end">
              <Menu.CheckboxItem checked={showRecent} onCheckedChange={setShowRecent} data-testid="activity-filter-recent">
                Show finished today
              </Menu.CheckboxItem>
            </Menu.Popup>
          </Menu.Root>
          <IconButton
            icon="x"
            label={ACTIVITY_COPY.hide}
            size="sm"
            shortcut={shortcutFor('activity.toggle')}
            data-testid="activity-close"
            onClick={onClose}
          />
        </>
      }
    >
      {ACTIVITY_COPY.title}
    </ActivityColumnHeader>
  );

  // ── Kind tabs ──
  const tabs = model ? (
    <SegmentedControl<ActivityKindFilter>
      semantics="tabs"
      fullWidth
      distribute="content"
      label="Activity kind"
      data-testid="activity-kinds"
      value={kind}
      onValueChange={setKind}
      items={[
        { value: 'all', label: 'All', count: model.counts.all } satisfies SegmentedItem<ActivityKindFilter>,
        ...ACTIVITY_KINDS.map(
          (k): SegmentedItem<ActivityKindFilter> => ({
            value: k,
            ariaLabel: ACTIVITY_KIND_META[k].plural,
            icon: ACTIVITY_KIND_META[k].icon as IconConcept,
            count: model.counts[k],
          }),
        ),
      ]}
    />
  ) : null;

  // ── Body ──
  let body;
  if (!model) {
    body = error ? (
      <Callout tone="err" title="Could not load activity" action={<Button size="sm" onClick={retry}>Retry</Button>}>
        {error}
      </Callout>
    ) : (
      <SkeletonRows rows={4} label="Loading activity" />
    );
  } else if (model.empty) {
    body = (
      <EmptyState
        framed
        icon="activity"
        title={ACTIVITY_COPY.emptyTitle}
        description={ACTIVITY_COPY.emptyDescription}
        className="mt-2 border-dashed"
        data-testid="activity-empty"
      />
    );
  } else if (entries.length === 0) {
    body = <p className="px-2 py-6 text-center text-small text-fg-3">{ACTIVITY_COPY.filteredEmpty}</p>;
  } else {
    body = (
      <div className="flex flex-col" onKeyDown={onListKeyDown} data-testid="activity-list">
        {ACTIVITY_GROUPS.map((group) => (
          <GroupSection
            key={group}
            group={group}
            entries={model.groups[group]}
            render={(entry) => (
              <div role="listitem" key={entry.key}>
                <ActivityItem
                  entry={entry}
                  now={entry.group === 'running' || entry.group === 'needs_you' ? now : minuteNow}
                  selected={entry.key === selectedKey}
                  modelLabel={modelLabel}
                  tabIndex={entry.key === rovingKey ? 0 : -1}
                  linkRef={(el) => {
                    if (el) links.current.set(entry.key, el);
                    else links.current.delete(entry.key);
                  }}
                  onFocusCard={setActiveKey}
                  {...(onNavigate ? { onNavigate } : {})}
                />
              </div>
            )}
          />
        ))}
        {finishedLoading && showRecent ? <SkeletonRows rows={2} label="Loading finished activity" /> : null}
      </div>
    );
  }

  return { header, tabs, body, onPanelKeyDown };
}

function GroupSection({
  group,
  entries,
  render,
}: {
  group: ActivityGroupId;
  entries: readonly ActivityEntry[];
  render: (entry: ActivityEntry) => ReactNode;
}) {
  if (entries.length === 0) return null;
  const tone = group === 'needs_you' ? 'warn' : group === 'failed' ? 'err' : 'neutral';
  return (
    <ActivityGroup aria-label={ACTIVITY_GROUP_LABELS[group]} data-testid={`activity-group-${group}`}>
      <SectionHeader
        variant="label"
        title={ACTIVITY_GROUP_LABELS[group]}
        count={group === 'recent' ? 'today' : entries.length}
        countTone={tone}
        className="px-1.5"
      />
      <div role="list" aria-label={ACTIVITY_GROUP_LABELS[group]} className="flex flex-col gap-0.5">
        {entries.map(render)}
      </div>
    </ActivityGroup>
  );
}

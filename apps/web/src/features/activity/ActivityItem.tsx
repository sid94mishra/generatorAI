// ────────────────────────────────────────────────────────────────
// ActivityItem (D-92) — one Activity card with its popover and its menu.
//
//   click / Enter   open the chat or run (the card is one link)
//   hover 300 ms    the popover beside the card (stays while the pointer is
//                   over the card or the popover; one open at a time)
//   keyboard focus  the same popover after 300 ms (focus stays on the card);
//                   → moves focus into it, Esc / ← come back
//   right-click     Open · Pin to top (chats) · Copy link · Retry / Dismiss
//                   (failures) · Stop (live); "Mute updates" is not drawn —
//                   there is no such setting (D-36)
//   orchestrators   a chevron expands the workers inline (EnhSidebarHidden)
// ────────────────────────────────────────────────────────────────

import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Link, useNavigate } from 'react-router';
import { activityTimeLabel, type ActivityEntry } from '@generatorai/client-core';
import { resolveStatus } from '@generatorai/shared';
import type { IconConcept } from '@generatorai/design-tokens';
import { useAttentionAction } from '@/hooks/attentionQueries.js';
import { useRetryActivity } from '@/hooks/activityQueries.js';
import { useSetChatPinned } from '@/hooks/chatListQueries.js';
import { useBackgroundTasks, useChat } from '@/hooks/queries.js';
import { isDesktop } from '@/lib/desktop.js';
import { useActivityStore } from '@/stores/activityStore.js';
import { ActivityCard } from '@/ui/patterns/ActivityCard/ActivityCard.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';
import { ActivityListRow } from '@/ui/patterns/ActivityPopover/ActivityPopover.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { ContextMenu } from '@/ui/primitives/Menu/Menu.js';
import { PopoverPopup, PopoverRoot } from '@/ui/primitives/Popover/Popover.js';
import { Reveal } from '@/ui/primitives/Collapsible/Collapsible.js';
import { ActivityDetails } from './ActivityDetails.js';
import { cardLine, cardMeta, cardStages, cardTone, kindIcon, kindLabel, stopLabel, stopTarget } from './activityView.js';

/** Hover / focus delay before the popover opens (board: 300 ms). */
export const PREVIEW_OPEN_MS = 300;
/** Grace while the pointer travels from the card to the popover. */
const PREVIEW_CLOSE_MS = 160;

export interface ActivityItemProps {
  entry: ActivityEntry;
  now: number;
  selected: boolean;
  modelLabel: (id: string) => string;
  /** Roving focus: only the active card is in the tab order. */
  tabIndex: 0 | -1;
  linkRef: Ref<HTMLAnchorElement>;
  onFocusCard: (key: string) => void;
  /** After the card navigates (the overlay column closes itself). */
  onNavigate?: () => void;
  /** Popover side: right of the column, right of the rail. */
  side?: 'right' | 'left';
}

/** The popover's open/close timing, shared by cards and rail tiles. */
export function usePreview(key: string) {
  const preview = useActivityStore((s) => s.preview);
  const setPreview = useActivityStore((s) => s.setPreview);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const open = preview === key;
  return {
    open,
    openSoon: () => {
      clear();
      timer.current = setTimeout(() => useActivityStore.getState().setPreview(key), PREVIEW_OPEN_MS);
    },
    openNow: () => {
      clear();
      setPreview(key);
    },
    closeSoon: () => {
      clear();
      timer.current = setTimeout(() => {
        if (useActivityStore.getState().preview === key) useActivityStore.getState().setPreview(null);
      }, PREVIEW_CLOSE_MS);
    },
    cancel: clear,
    close: () => {
      clear();
      if (useActivityStore.getState().preview === key) setPreview(null);
    },
  };
}

function copyLink(href: string): void {
  const link = isDesktop ? `generatorai:/${href}` : `${window.location.origin}${href}`;
  void navigator.clipboard?.writeText(link).catch(() => undefined);
}

export function ActivityItem({ entry, now, selected, modelLabel, tabIndex, linkRef, onFocusCard, onNavigate, side = 'right' }: ActivityItemProps) {
  const navigate = useNavigate();
  const preview = usePreview(entry.key);
  const cardRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const localLink = useRef<HTMLAnchorElement | null>(null);
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  /** Focus handed back after the popover closed: do not reopen it on that focus. */
  const returning = useRef(false);
  const act = useAttentionAction();
  const retry = useRetryActivity();
  const dismiss = useActivityStore((s) => s.dismiss);

  const setLink = (el: HTMLAnchorElement | null) => {
    localLink.current = el;
    if (typeof linkRef === 'function') linkRef(el);
    else if (linkRef) (linkRef as { current: HTMLAnchorElement | null }).current = el;
  };

  const focusIntoPopup = () => {
    preview.openNow();
    // The popup renders on the next frame; focus its first control.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => popupRef.current?.querySelector<HTMLElement>('button, a[href]')?.focus());
    });
  };

  const onLinkKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === 'ArrowRight' && side === 'right') {
      e.preventDefault();
      focusIntoPopup();
    } else if (e.key === 'Escape' && preview.open) {
      e.preventDefault();
      e.stopPropagation();
      preview.close();
    }
  };

  const onPopupKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      preview.close();
      returning.current = true;
      localLink.current?.focus();
    }
  };

  const tone = cardTone(entry);
  const stopItem = stopTarget(entry);
  const moreAsks = entry.asks.length - 1;
  const canExpand = entry.kind === 'orchestrator' && (entry.meta?.workers?.total ?? 0) > 0 && entry.group !== 'recent';

  return (
    <ContextMenu.Root>
      <PopoverRoot
        open={preview.open}
        onOpenChange={(next) => {
          if (next) return;
          // Esc / an outside press while focus is in the popover: back to the card, never to nowhere.
          const inside = popupRef.current?.contains(document.activeElement) ?? false;
          preview.close();
          if (inside) {
            returning.current = true;
            localLink.current?.focus();
          }
        }}
      >
        <ContextMenu.Trigger
          render={
            <ActivityCard
              ref={cardRef}
              data-testid="activity-card"
              data-group={entry.group}
              data-kind={entry.kind}
              data-entity-id={entry.entityId}
              kindIcon={kindIcon(entry)}
              kindLabel={kindLabel(entry)}
              title={entry.title}
              time={activityTimeLabel(entry, now)}
              line={cardLine(entry)}
              lineExtra={
                <>
                  {moreAsks > 0 ? <span>+{moreAsks}</span> : null}
                  {entry.group === 'recent' && entry.changes && (entry.changes.additions > 0 || entry.changes.deletions > 0) ? (
                    <DiffStat added={entry.changes.additions} removed={entry.changes.deletions} files={entry.changes.files} />
                  ) : null}
                </>
              }
              stages={cardStages(entry)}
              meta={cardMeta(entry, modelLabel)}
              metaEnd={entry.project?.name}
              tone={tone}
              selected={selected}
              unread={entry.unread}
              link={<Link to={entry.href} />}
              linkProps={{
                ref: setLink,
                tabIndex,
                onFocus: (e: { currentTarget: HTMLElement }) => {
                  onFocusCard(entry.key);
                  if (returning.current) returning.current = false;
                  else if (e.currentTarget.matches(':focus-visible')) preview.openSoon();
                },
                onBlur: (e: { relatedTarget: EventTarget | null }) => {
                  if (e.relatedTarget instanceof Node && popupRef.current?.contains(e.relatedTarget)) return;
                  preview.closeSoon();
                },
                onKeyDown: onLinkKeyDown,
                onClick: () => {
                  preview.close();
                  onNavigate?.();
                },
                'aria-keyshortcuts': side === 'right' ? 'ArrowRight' : undefined,
              }}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') preview.openSoon();
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse') preview.closeSoon();
              }}
              trailing={
                canExpand ? (
                  <IconButton
                    icon={expanded ? 'chevron-up' : 'chevron-down'}
                    label={expanded ? 'Hide workers' : 'Show workers'}
                    size="sm"
                    aria-expanded={expanded}
                    tabIndex={tabIndex}
                    onClick={() => setExpanded((v) => !v)}
                  />
                ) : undefined
              }
            >
              {canExpand ? (
                // The workers ease open under the card (D-108); the gap rides inside the panel.
                <Reveal open={expanded}>
                  <div className="pt-1.5">
                    <InlineWorkers entry={entry} modelLabel={modelLabel} />
                  </div>
                </Reveal>
              ) : null}
            </ActivityCard>
          }
        />
        {preview.open ? (
          <PopoverPopup
            ref={popupRef}
            anchor={cardRef}
            side={side}
            align="start"
            sideOffset={10}
            collisionPadding={8}
            initialFocus={false}
            finalFocus={false}
            aria-labelledby={titleId}
            className="w-aside overflow-hidden rounded-panel"
            onPointerEnter={() => preview.cancel()}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') preview.closeSoon();
            }}
            onKeyDown={onPopupKeyDown}
          >
            <ActivityDetails
              entry={entry}
              now={now}
              modelLabel={modelLabel}
              titleId={titleId}
              onDone={preview.close}
              {...(onNavigate ? { onNavigate } : {})}
            />
          </PopoverPopup>
        ) : null}
      </PopoverRoot>
      <ContextMenu.Popup aria-label={`${entry.title} actions`}>
        <ContextMenu.Item icon="external-link" shortcut={['↵']} onClick={() => { navigate(entry.href); onNavigate?.(); }}>
          Open
        </ContextMenu.Item>
        {entry.entity === 'chat' ? <PinItem chatId={entry.entityId} /> : null}
        <ContextMenu.Item icon="link" onClick={() => copyLink(entry.href)}>
          Copy link
        </ContextMenu.Item>
        {entry.retry && entry.recent ? (
          <ContextMenu.Item icon="retry" onClick={() => retry.mutate(entry.recent!)}>
            {entry.retry === 'run_retry' ? 'Retry run' : 'Retry last prompt'}
          </ContextMenu.Item>
        ) : null}
        {entry.dismissKey ? (
          <ContextMenu.Item icon="x" onClick={() => dismiss(entry.dismissKey!)}>
            Dismiss
          </ContextMenu.Item>
        ) : null}
        {stopItem ? (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item icon="stop" danger onClick={() => act.mutate({ item: stopItem, action: 'stop' })}>
              {stopLabel(entry)}
            </ContextMenu.Item>
          </>
        ) : null}
      </ContextMenu.Popup>
    </ContextMenu.Root>
  );
}

/** "Pin to top" / "Unpin" for a chat card (read when the menu opens). */
function PinItem({ chatId }: { chatId: string }) {
  const chat = useChat(chatId);
  const pin = useSetChatPinned();
  if (!chat.data) return null;
  const pinned = Boolean(chat.data.pinnedAt);
  return (
    <ContextMenu.Item
      icon="pin"
      onClick={() => pin.mutate({ chatId, pinned: !pinned }, { onSettled: () => void chat.refetch() })}
    >
      {pinned ? 'Unpin' : 'Pin to top'}
    </ContextMenu.Item>
  );
}

/** An orchestrator's workers, expanded inside its card (EnhSidebarHidden). */
function InlineWorkers({ entry, modelLabel }: { entry: ActivityEntry; modelLabel: (id: string) => string }) {
  const tasks = useBackgroundTasks(entry.entityId, true, { poll: false });
  const tally = JSON.stringify(entry.meta?.workers);
  const { refetch } = tasks;
  useEffect(() => {
    void refetch();
  }, [tally, refetch]);
  if (!tasks.data) return null;
  return (
    <div className="flex flex-col border-l border-line pl-2" data-testid="activity-card-workers">
      {tasks.data.tasks.map((task) => {
        const status = resolveStatus('backgroundTask', task.status);
        const asking = entry.worker?.id === task.taskId;
        const state = asking ? 'needs_you' : (status?.state ?? 'queued');
        return (
          <ActivityListRow
            key={task.taskId}
            icon={`status-${state === 'needs_you' ? 'needs-you' : state}` as IconConcept}
            tone={state === 'running' ? 'run' : state === 'succeeded' ? 'ok' : state === 'needs_you' ? 'warn' : state === 'failed' ? 'err' : 'muted'}
            spin={state === 'running'}
            name={task.taskName}
            detail={task.model ? modelLabel(task.model) : undefined}
            end={asking ? 'needs you' : (status?.label ?? task.status).toLowerCase()}
            endTone={asking}
          />
        );
      })}
    </div>
  );
}

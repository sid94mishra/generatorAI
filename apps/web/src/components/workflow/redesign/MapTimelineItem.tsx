// ────────────────────────────────────────────────────────────────
// MapTimelineItem — a map instance (P05 §4.1) on the run timeline.
//
//   ● Per file  Running  ⇉ 3/7 done · 4 at a time · mount per item  …
//   │  All · a.ts✓ · b.ts• · c.ts✗ · …
//   │  item details: status, phase, error, PR link, the item's mount
//   │  ● edit (the body instances of the selected item)
//
// The row is a StageTimelineItem (the page's renderer) whose transcript is
// replaced by the items; body instances render through ControlFlowNode,
// so a loop or a map nested in an item works the same way.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { Split, GitPullRequest, FolderGit2 } from 'lucide-react';
import type { MapItemView } from '@generatorai/shared';
import type { RunCommand } from '@generatorai/workflow-spec';
import { cn } from '@/lib/utils.js';
import { TabsRoot, TabsList, TabsTrigger } from '@/components/ui/index.js';
import type { RenderStage } from './LoopTimelineItem.js';
import { ControlFlowNode } from './ControlFlowNode.js';
import type { MapView, StageView } from './types.js';

interface MapTimelineItemProps {
  runId: string;
  stage: StageView;
  bodies: Record<string, StageView[]>;
  focusedId: string | null;
  showConnector: boolean;
  renderStage: RenderStage;
  onCommand: (command: RunCommand) => Promise<void>;
}

const CHIP = 'hidden shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium md:inline-flex';

export function MapHeaderBadges({ map }: { map: MapView }) {
  return (
    <>
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-primary)]/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--color-primary)]"
        title={`${map.done} of ${map.count} items settled`}
      >
        <Split className="h-2.5 w-2.5" />
        {map.done}/{map.count}
      </span>
      {map.concurrency !== undefined && (
        <span className={cn(CHIP, 'bg-[var(--color-muted-foreground)]/10 text-[var(--color-muted-foreground)]')}>
          {map.concurrency} at a time{map.workspace === 'mount_per_item' ? ` · mount per item${map.merge && map.merge !== 'none' ? ` · ${map.merge.replace(/_/g, ' ')}` : ''}` : ''}
        </span>
      )}
      {map.failed > 0 && (
        <span className={cn(CHIP, 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]')}>
          {map.failed} failed{map.toleratedFailurePercent ? ` (tolerated ${map.toleratedFailurePercent}%)` : ''}
        </span>
      )}
      {map.winner && (
        <span
          className={cn(
            CHIP,
            map.winner.outcome === 'failed'
              ? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
              : 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
          )}
          title={map.winner.error ?? undefined}
        >
          {map.winner.phase === 'waiting'
            ? 'waiting for the judge'
            : map.winner.phase === 'merging'
              ? `merging winner ${map.winner.key ?? ''}`
              : map.winner.outcome === 'merged'
                ? `winner ${map.winner.key ?? ''} merged`
                : map.winner.outcome === 'none'
                  ? 'no winner'
                  : 'winner merge failed'}
        </span>
      )}
    </>
  );
}

function itemDot(it: MapItemView): string {
  if (it.status === 'completed') return 'bg-[var(--color-success)]';
  if (it.status === 'failed' || it.status === 'cancelled') return 'bg-[var(--color-danger)]';
  if (it.phase === 'pending') return 'bg-[var(--color-muted-foreground)]/40';
  return 'bg-[var(--color-primary)] animate-status-breathe';
}

function ItemDetails({ item }: { item: MapItemView }) {
  return (
    <div className="space-y-1 rounded-md border border-[var(--color-border)]/60 bg-[var(--color-subtle)]/30 p-2.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--color-muted-foreground)]">
        <span>Key <span className="font-mono text-[var(--color-foreground)]">{item.key}</span></span>
        <span>Status <span className="text-[var(--color-foreground)]">{item.status ?? item.phase.replace(/_/g, ' ')}</span></span>
        {item.branch && <span>Branch <span className="font-mono text-[var(--color-foreground)]">{item.branch}</span></span>}
        {item.pr?.url && (
          <a href={item.pr.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline">
            <GitPullRequest className="h-3 w-3" />
            Pull request
          </a>
        )}
      </div>
      {item.primaryDir && (
        <p className="truncate text-[var(--color-muted-foreground)]" title={item.primaryDir}>
          <FolderGit2 className="mr-1 inline h-3 w-3" />
          Item mount <span className="font-mono text-[var(--color-foreground)]/80">{item.primaryDir}</span>
        </p>
      )}
      {item.error && <p className="whitespace-pre-wrap text-[var(--color-danger)]">{item.errorCode ? `${item.errorCode}: ` : ''}{item.error}</p>}
      <details>
        <summary className="cursor-pointer text-[var(--color-muted-foreground)]">Item</summary>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] text-[var(--color-foreground)]/80">
          {(() => {
            try {
              return JSON.stringify(item.item, null, 2);
            } catch {
              return String(item.item);
            }
          })()}
        </pre>
      </details>
    </div>
  );
}

type ItemTab = number | 'all';

export function MapTimelineItem({ runId, stage, bodies, focusedId, showConnector, renderStage, onCommand }: MapTimelineItemProps) {
  const map = stage.map!;
  const body = useMemo(() => bodies[stage.id] ?? [], [bodies, stage.id]);
  const byItem = useMemo(() => {
    const out = new Map<number, StageView[]>();
    for (const s of body) {
      const i = s.itemIndex ?? 0;
      out.set(i, [...(out.get(i) ?? []), s]);
    }
    return out;
  }, [body]);

  const running = map.items.find((i) => i.phase === 'running' || i.phase === 'preparing' || i.phase === 'merging');
  const [picked, setPicked] = useState<ItemTab | null>(null);
  const tab: ItemTab = picked ?? (map.items.length > 1 ? 'all' : (running?.index ?? 0));

  // Focus landing on one of this map's body instances opens its item.
  const focusedItem = useMemo(() => {
    const hit = focusedId ? body.find((s) => s.id === focusedId) : undefined;
    return hit ? (hit.itemIndex ?? 0) : null;
  }, [focusedId, body]);
  useEffect(() => {
    if (focusedItem !== null) setPicked(focusedItem);
  }, [focusedItem]);

  const renderInstances = (list: StageView[]) =>
    list.map((s, i) => (
      <ControlFlowNode
        key={s.id}
        runId={runId}
        stage={s}
        bodies={bodies}
        focusedId={focusedId}
        showConnector={i < list.length - 1}
        renderStage={renderStage}
        onCommand={onCommand}
        inContainer
      />
    ));

  const mapBody = (
    <div className="space-y-2.5">
      {map.items.length === 0 ? (
        <p className="text-[11.5px] text-[var(--color-muted-foreground)]">
          {map.phase === 'snapshotting' ? 'Snapshotting the run mounts for the item worktrees…' : 'The map has no items yet.'}
        </p>
      ) : (
        <>
          <TabsRoot value={String(tab)} onValueChange={(v) => setPicked(v === 'all' ? 'all' : Number(v))}>
            <TabsList className="overflow-x-auto" aria-label={`Items of ${stage.name}`}>
              {map.items.length > 1 && (
                <TabsTrigger value="all" className="px-2 py-1 text-[11.5px]">
                  All
                </TabsTrigger>
              )}
              {map.items.map((it) => (
                <TabsTrigger key={it.index} value={String(it.index)} className="max-w-[160px] px-2 py-1 text-[11.5px]" title={`Item ${it.index + 1}: ${it.key}`}>
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', itemDot(it))} aria-hidden />
                  <span className="truncate">{it.key}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </TabsRoot>

          {tab === 'all' &&
            map.items.map((it) => (
              <div key={it.index} className="space-y-2">
                <div className="flex items-center gap-2 pt-1" role="separator">
                  <span className="h-px flex-1 bg-[var(--color-border)]" />
                  <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                    {it.key}
                    <span className="ml-1.5 font-normal normal-case tracking-normal">· {it.status ?? it.phase.replace(/_/g, ' ')}</span>
                  </span>
                  <span className="h-px flex-1 bg-[var(--color-border)]" />
                </div>
                {it.error && <p className="text-[11px] text-[var(--color-danger)]">{it.error}</p>}
                {renderInstances(byItem.get(it.index) ?? [])}
              </div>
            ))}

          {typeof tab === 'number' && map.items[tab] && (
            <div className="space-y-2">
              <ItemDetails item={map.items[tab]!} />
              {(byItem.get(tab) ?? []).length > 0 ? (
                renderInstances(byItem.get(tab) ?? [])
              ) : (
                <p className="text-[11.5px] text-[var(--color-muted-foreground)]">No stage of this item has started yet.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  return <>{renderStage(stage, { showConnector, headerExtra: <MapHeaderBadges map={map} />, body: mapBody })}</>;
}

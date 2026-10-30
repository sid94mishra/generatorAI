// ────────────────────────────────────────────────────────────────
// MapRow — a map instance (P05 §4.1) in the run's stage table.
//
//   ⌄ ◌ Per file  3/7  4 at a time · mount per item
//       [All] [✓ a.ts] [◌ b.ts] [✗ c.ts] …
//       item details: key, status, branch, PR link, the item's mount, error
//       ⌄ edit (the body rows of the selected item, one depth deeper)
//
// The row is the page's StageRow (through `renderStage`) whose transcript
// is replaced by the items; body instances render through ControlFlowNode,
// so a loop or a map nested in an item works the same way.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import type { MapItemView } from '@generatorai/shared';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Collapsible } from '@/ui/primitives/Collapsible/Collapsible.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { BodyRows, type ControlFlowNodeProps } from './ControlFlowNode.js';
import type { MapView } from '../model/types.js';

export function MapHeaderBadges({ map }: { map: MapView }) {
  return (
    <>
      <Badge tone="run" icon="layers" className="font-mono tabular-nums" title={`${map.done} of ${map.count} items settled`}>
        {map.done}/{map.count}
      </Badge>
      {map.concurrency !== undefined && (
        <Badge className="hidden md:inline-flex">
          {map.concurrency} at a time
          {map.workspace === 'mount_per_item' ? ` · mount per item${map.merge && map.merge !== 'none' ? ` · ${map.merge.replace(/_/g, ' ')}` : ''}` : ''}
        </Badge>
      )}
      {map.failed > 0 && (
        <Badge tone="err" className="hidden md:inline-flex">
          {map.failed} failed{map.toleratedFailurePercent ? ` (tolerated ${map.toleratedFailurePercent}%)` : ''}
        </Badge>
      )}
      {map.winner && (
        <Badge tone={map.winner.outcome === 'failed' ? 'err' : 'ok'} className="hidden md:inline-flex" title={map.winner.error ?? undefined}>
          {map.winner.phase === 'waiting'
            ? 'waiting for the judge'
            : map.winner.phase === 'merging'
              ? `merging winner ${map.winner.key ?? ''}`
              : map.winner.outcome === 'merged'
                ? `winner ${map.winner.key ?? ''} merged`
                : map.winner.outcome === 'none'
                  ? 'no winner'
                  : 'winner merge failed'}
        </Badge>
      )}
    </>
  );
}

/** An item's status glyph (the D-18 status concepts). */
function itemGlyph(it: MapItemView): IconConcept {
  if (it.status === 'completed') return 'status-succeeded';
  if (it.status === 'failed') return 'status-failed';
  if (it.status === 'cancelled') return 'status-skipped';
  if (it.phase === 'pending') return 'status-queued';
  return 'status-running';
}

function itemJson(item: unknown): string {
  try {
    return JSON.stringify(item, null, 2);
  } catch {
    return String(item);
  }
}

function ItemDetails({ item }: { item: MapItemView }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-card border border-line-soft bg-sunken p-3 text-small text-fg-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          Key <span className="font-mono text-fg">{item.key}</span>
        </span>
        <span>
          Status <span className="text-fg">{item.status ?? item.phase.replace(/_/g, ' ')}</span>
        </span>
        {item.branch && (
          <span>
            Branch <span className="font-mono text-fg">{item.branch}</span>
          </span>
        )}
        {item.pr?.url && (
          <Link variant="external" href={item.pr.url} className="gap-1">
            <Icon concept="pr" size={12} />
            Pull request
          </Link>
        )}
      </div>
      {item.primaryDir && (
        <p className="flex min-w-0 items-center gap-1" title={item.primaryDir}>
          <Icon concept="folder-open" size={12} className="shrink-0" />
          <span className="shrink-0">Item mount</span>
          <span className="truncate font-mono text-fg-2">{item.primaryDir}</span>
        </p>
      )}
      {item.error && (
        <p className="whitespace-pre-wrap text-err">
          {item.errorCode ? `${item.errorCode}: ` : ''}
          {item.error}
        </p>
      )}
      <Collapsible trigger="Item" variant="disclosure">
        <pre className="max-h-32 overflow-auto font-mono text-micro break-all whitespace-pre-wrap text-fg-2">{itemJson(item.item)}</pre>
      </Collapsible>
    </div>
  );
}

type ItemTab = number | 'all';

export function MapRow({ runId, stage, bodies, focusedId, showConnector, renderStage, onCommand, depth = 0 }: ControlFlowNodeProps) {
  const map = stage.map!;
  const body = useMemo(() => bodies[stage.id] ?? [], [bodies, stage.id]);
  const byItem = useMemo(() => {
    const out = new Map<number, typeof body>();
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

  const parent = { runId, bodies, focusedId, renderStage, onCommand, depth };
  const items: SegmentedItem[] = [
    ...(map.items.length > 1 ? [{ value: 'all', label: 'All' }] : []),
    ...map.items.map((it): SegmentedItem => ({ value: String(it.index), label: it.key, icon: itemGlyph(it) })),
  ];

  const mapBody = (
    <div className="flex flex-col gap-3">
      {map.items.length === 0 ? (
        <p className="text-small text-fg-3">
          {map.phase === 'snapshotting' ? 'Snapshotting the run mounts for the item worktrees…' : 'The map has no items yet.'}
        </p>
      ) : (
        <>
          <SegmentedControl
            semantics="tabs"
            label={`Items of ${stage.name}`}
            value={String(tab)}
            onValueChange={(v) => setPicked(v === 'all' ? 'all' : Number(v))}
            items={items}
            className="max-w-full self-start overflow-x-auto"
          />

          {tab === 'all' &&
            map.items.map((it) => (
              <div key={it.index} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 pt-1" role="separator" aria-label={it.key}>
                  <span className="flex-1 border-t border-line-soft" />
                  <span className="text-small font-medium text-fg-2">
                    {it.key}
                    <span className="ml-1.5 font-normal text-fg-3">· {it.status ?? it.phase.replace(/_/g, ' ')}</span>
                  </span>
                  <span className="flex-1 border-t border-line-soft" />
                </div>
                {it.error && <p className="text-small text-err">{it.error}</p>}
                <BodyRows list={byItem.get(it.index) ?? []} parent={parent} />
              </div>
            ))}

          {typeof tab === 'number' && map.items[tab] && (
            <div className="flex flex-col gap-2">
              <ItemDetails item={map.items[tab]} />
              {(byItem.get(tab) ?? []).length > 0 ? (
                <BodyRows list={byItem.get(tab) ?? []} parent={parent} />
              ) : (
                <p className="text-small text-fg-3">No stage of this item has started yet.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  return <>{renderStage(stage, { showConnector, depth, headerExtra: <MapHeaderBadges map={map} />, body: mapBody })}</>;
}

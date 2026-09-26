// ────────────────────────────────────────────────────────────────
// CheckpointScrubberView — the Changes dock's checkpoint strip (F-dock-01)
// ────────────────────────────────────────────────────────────────
//
// Pure view over grouped checkpoints; CheckpointScrubber feeds it from the
// server. One compact strip instead of the legacy 288px timeline column:
//
//   header  Turn 3 of 4 · 14:02:18 · +14 −6 ········ Compare · ↺ Rewind · ×
//   track   start ── 14:00 ── 14:01 ── [14:02] ── 14:05     (kit Slider)
//   caption You: “Also cover the zero-discount case…” · 2 files
//
// The header shows the SELECTED stop (default: the newest). Rewinding is a
// normal, recoverable action — the server writes a `pre_restore` checkpoint
// (a "Redo point") before touching the working tree — so it confirms inline
// rather than in a dialog, and the outcome is reported per mount.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import type { RestoreCheckpointResult } from '@/types/changes.js';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Slider, type SliderTick } from '@/ui/primitives/Slider/Slider.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';
import {
  checkpointStops,
  describePrompt,
  formatAliasList,
  mountName,
  type CheckpointGroup,
  type CheckpointStop,
} from './checkpointGroups.js';

/** One rewind's outcome, per mount. */
export interface RewindReport {
  group: CheckpointGroup;
  perMount: Array<{ alias: string; result?: RestoreCheckpointResult; error?: string }>;
}

export interface CheckpointScrubberViewProps {
  /** Grouped checkpoints, in any order (the view sorts them oldest → newest). */
  groups: readonly CheckpointGroup[];
  loading?: boolean;
  /** A rewind is running: the confirm button shows "Rewinding…". */
  rewinding?: boolean;
  /** The last rewind's outcome; `null` hides the banner. */
  report?: RewindReport | null;
  onClose: () => void;
  /** Receives the stop's revision selector (`turn:<id>` / `checkpoint:<id>`). */
  onCompare?: (revisionSelector: string) => void;
  /** Restore every mount the group touched (called after the inline confirm). */
  onRewind: (group: CheckpointGroup) => void | Promise<void>;
  onDismissReport: () => void;
  className?: string;
}

/** Stops beyond this many only label the first, the last and the selected one. */
const MAX_LABELLED_TICKS = 6;

const TIME_WITH_SECONDS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
const TIME_SHORT: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

function formatTime(iso: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, options);
}

function tickText(stop: CheckpointStop): string {
  return stop.group.kind === 'baseline' ? 'start' : formatTime(stop.group.createdAt, TIME_SHORT);
}

/** The Changes dock's checkpoint scrubber: pick a stop, compare against it or rewind to it. */
export function CheckpointScrubberView({
  groups,
  loading = false,
  rewinding = false,
  report = null,
  onClose,
  onCompare,
  onRewind,
  onDismissReport,
  className,
}: CheckpointScrubberViewProps) {
  const stops = useMemo(() => checkpointStops(groups), [groups]);
  // null = follow the newest stop, so a turn that lands while the strip is
  // open becomes the selection until the user picks another.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);

  const found = stops.findIndex((s) => s.group.key === selectedKey);
  const selectedIndex = found >= 0 ? found : stops.length - 1;
  const selected = stops[selectedIndex];
  const group = selected?.group;
  const confirming = group !== undefined && confirmingKey === group.key;

  const confirmRewind = async (target: CheckpointGroup) => {
    await onRewind(target);
    setConfirmingKey(null);
  };

  const ticks = useMemo<SliderTick[]>(
    () =>
      stops.map((stop, index) => {
        const labelled =
          stops.length <= MAX_LABELLED_TICKS || index === 0 || index === stops.length - 1 || index === selectedIndex;
        const text = labelled ? tickText(stop) : '';
        return {
          value: index,
          label: index === selectedIndex ? <span className="font-medium text-fg">{text}</span> : text,
        };
      }),
    [stops, selectedIndex],
  );

  const close = <IconButton icon="x" label="Close checkpoints" size="sm" onClick={onClose} />;

  return (
    <section aria-label="Checkpoints" className={cn('flex flex-col gap-2 bg-surface px-3 py-2', className)}>
      <div className="flex h-control items-center gap-2">
        {loading ? (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-small text-fg-3">
            <Spinner size={14} label="Loading checkpoints" />
            Loading checkpoints…
          </span>
        ) : !selected || !group ? (
          <span className="min-w-0 flex-1 truncate text-small text-fg-3">No checkpoints yet.</span>
        ) : (
          <>
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate text-ui font-medium text-fg">{selected.title}</span>
              <span className="shrink-0 font-mono text-micro text-fg-3">
                {formatTime(group.createdAt, TIME_WITH_SECONDS)}
              </span>
              {group.additions + group.deletions > 0 ? (
                <DiffStat added={group.additions} removed={group.deletions} className="shrink-0" />
              ) : null}
            </span>
            {onCompare ? (
              <Tooltip content="Use as the diff base">
                <Button variant="ghost" size="sm" onClick={() => onCompare(group.compareValue)}>
                  Compare
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip content="Rewind the workspace to this point">
              <Button
                size="sm"
                icon="undo"
                onClick={() => setConfirmingKey(group.key)}
                disabled={rewinding || group.restoreTargets.length === 0}
              >
                Rewind
              </Button>
            </Tooltip>
          </>
        )}
        {close}
      </div>

      {stops.length > 1 ? (
        // The edge tick labels are centred on their stop; the inset keeps
        // "start" and the newest time inside the panel.
        <div className="px-5">
        <Slider
          label="Checkpoint"
          min={0}
          max={stops.length - 1}
          step={1}
          value={selectedIndex}
          onValueChange={(index) => setSelectedKey(stops[index]?.group.key ?? null)}
          getAriaValueText={(index) => {
            const stop = stops[index];
            return stop ? `${stop.title}, ${formatTime(stop.group.createdAt, TIME_WITH_SECONDS)}` : '';
          }}
          ticks={ticks}
        />
        </div>
      ) : null}

      {group ? <Caption group={group} /> : null}

      {group && confirming ? (
        <Callout
          tone="warn"
          title={`Rewind ${formatAliasList(group.aliases)} ${group.undoesTurn ? 'to before this turn' : 'to this checkpoint'}?`}
          action={
            <span className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setConfirmingKey(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" loading={rewinding} onClick={() => void confirmRewind(group)}>
                {rewinding
                  ? 'Rewinding…'
                  : group.restoreTargets.length > 1
                    ? `Rewind ${String(group.restoreTargets.length)} sources`
                    : 'Confirm rewind'}
              </Button>
            </span>
          }
        >
          Current work is saved to a &ldquo;Redo point&rdquo; first, so you can undo it.
        </Callout>
      ) : null}

      {report ? <RewindResult report={report} onDismiss={onDismissReport} /> : null}
    </section>
  );
}

/** `You: “prompt” · 2 files · api, web` — only the parts the checkpoint carries. */
function Caption({ group }: { group: CheckpointGroup }) {
  const parts = [
    group.promptExcerpt ? `You: “${describePrompt(group.promptExcerpt)}”` : null,
    `${String(group.fileCount)} ${group.fileCount === 1 ? 'file' : 'files'}`,
    // Which mounts the stop spans: without it a rewind in a multi-source chat is blind.
    group.aliases.length > 1 ? group.aliases.map(mountName).join(', ') : null,
  ].filter((part): part is string => part !== null);
  return <p className="truncate text-small text-fg-3">{parts.join(' · ')}</p>;
}

/**
 * What the rewind actually did, mount by mount.
 *
 * Per mount rather than one total because a multi-source rewind can partly
 * fail — a repository that went dirty in the meantime, a path the server
 * refused to write through — and a single "restored 12 files" line would hide
 * exactly the half the user needs to act on.
 */
function RewindResult({ report, onDismiss }: { report: RewindReport; onDismiss: () => void }) {
  const successes = report.perMount.filter((m) => m.result);
  const failed = report.perMount.length - successes.length;
  const undoable = successes.some((m) => m.result?.preRestoreCheckpointId);
  const skipped = successes.flatMap((m) =>
    (m.result?.skipped ?? []).slice(0, 6).map((sk) => ({ key: `${m.alias}:${sk.path}`, alias: m.alias, ...sk })),
  );

  const tone = failed === 0 ? 'ok' : successes.length === 0 ? 'err' : 'warn';
  const title =
    failed === 0
      ? `Rewound ${formatAliasList(successes.map((m) => m.alias))}`
      : successes.length === 0
        ? 'The rewind failed'
        : `Rewound ${String(successes.length)} of ${String(report.perMount.length)} sources`;

  return (
    <Callout
      tone={tone}
      role={tone === 'err' ? 'alert' : 'status'}
      title={title}
      action={
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    >
      <ul className="flex flex-col">
        {report.perMount.map((entry) => (
          <li key={entry.alias}>
            <span className="font-mono">{mountName(entry.alias)}</span>
            {entry.result ? (
              <>
                {' '}— {entry.result.restoredPaths.length} restored, {entry.result.deletedPaths.length} removed
                {entry.result.skipped.length > 0 ? (
                  <span className="text-warn">, {entry.result.skipped.length} skipped for safety</span>
                ) : null}
              </>
            ) : (
              <span className="text-err"> — {entry.error}</span>
            )}
          </li>
        ))}
      </ul>
      {/* Symlinks and hard links can resolve outside the workspace, so the
          server refuses to write through them. Naming the paths is the only
          way the user can tell what was left behind. */}
      {skipped.length > 0 ? (
        <ul className="mt-1 flex flex-col font-mono text-warn">
          {skipped.map((sk) => (
            <li key={sk.key}>
              {sk.alias === '.' ? '' : `${sk.alias}/`}
              {sk.path} — {sk.reason}
            </li>
          ))}
        </ul>
      ) : null}
      {undoable ? <p className="mt-1">A &ldquo;Redo point&rdquo; was saved first, so this is undoable.</p> : null}
    </Callout>
  );
}

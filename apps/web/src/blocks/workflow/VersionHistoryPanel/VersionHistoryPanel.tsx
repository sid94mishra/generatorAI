// ────────────────────────────────────────────────────────────────
// WF-10 VersionHistoryPanel — a definition's versions, in place of the
// builder's inspector (WorkflowAgentDraft board, right side):
//
//   intro     "Every run pins the version it started on. …"
//   Draft     the editor's working copy (chips, revision, what publishing
//             would do); tickable, so any version compares with the editor
//   Versions  newest first: tick · vN · Live / test · date · short hash ·
//             row menu (Restore as draft, Compare with the draft); older
//             rows fold behind "N older"
//   actions   Diff vA ↔ vB · Restore vN as draft
//   diff      "v6 ↔ v7" + summary, rows M/A/D · stage key or edge · field
//             before → after
//
// Presentational: rows, selection and the diff come in as props.
// ────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Inspector } from '@/ui/patterns/Inspector/Inspector.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { KeyChip } from '../chips/WorkflowChips.js';

/** The id of the editor's working copy in `selected`. */
export const DRAFT_ID = 'draft';

export interface VersionHistoryRow {
  id: string;
  version: number;
  kind: 'published' | 'test';
  createdAt: Date;
  /** Content hash; the first 7 characters show. */
  hash: string;
  /** The version runs use now. */
  live?: boolean | undefined;
}

export interface VersionHistoryDraft {
  /** Chips heading the card (DraftChip, "Agent draft" …). */
  badges: ReactNode;
  revision?: number | null | undefined;
  /** "Unsaved changes in the editor" / "not published" … */
  meta?: ReactNode;
  /** "Publishing makes it v8 and replaces v7 for new runs." */
  note?: ReactNode;
}

export type VersionDiffSubject = { kind: 'stage'; key: string } | { kind: 'edge'; from: string; to: string } | { kind: 'workflow' };

export interface VersionDiffRow {
  id: string;
  op: 'added' | 'removed' | 'changed';
  subject: VersionDiffSubject;
  /** The changed field (`session.reasoningEffort`). */
  field?: string | undefined;
  before?: string | undefined;
  after?: string | undefined;
  /** Free text after the subject ("Check licenses (check)"). */
  detail?: string | undefined;
}

export interface VersionDiffView {
  /** "v6 ↔ v7". */
  title: string;
  /** "3 stages, 1 edge". */
  summary?: string | undefined;
  rows: readonly VersionDiffRow[];
  loading?: boolean | undefined;
  error?: string | null | undefined;
}

export interface VersionHistoryPanelProps {
  intro?: ReactNode;
  draft?: VersionHistoryDraft | null | undefined;
  versions?: readonly VersionHistoryRow[] | undefined;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  /** Ticked rows, in the order they were ticked: version ids and/or DRAFT_ID. */
  selected: readonly string[];
  /** The next selection (ticking a third row drops the earliest tick). */
  onSelectionChange: (selected: string[]) => void;
  /** Show the diff of the two ticked rows. */
  onCompare: () => void;
  /** The ticked pair already shows below (the Diff button is then pressed). */
  compared?: boolean | undefined;
  /** Load a version into the editor as unsaved changes. */
  onRestore: (id: string) => void;
  restoringId?: string | null | undefined;
  restoreError?: string | null | undefined;
  diff?: VersionDiffView | null | undefined;
  onClose: () => void;
  /** Rows shown before "N older". Default 5. */
  visibleCount?: number | undefined;
  className?: string | undefined;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fullDate(d: Date): string {
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const OP: Record<VersionDiffRow['op'], { letter: string; tone: string; label: string }> = {
  added: { letter: 'A', tone: 'text-ok', label: 'Added' },
  removed: { letter: 'D', tone: 'text-err', label: 'Removed' },
  changed: { letter: 'M', tone: 'text-warn', label: 'Changed' },
};

function Subject({ subject }: { subject: VersionDiffSubject }) {
  if (subject.kind === 'stage') return <KeyChip outlined stageKey={subject.key} />;
  if (subject.kind === 'edge') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="text-fg-3">edge</span>
        <KeyChip outlined stageKey={subject.from} />
        <span className="text-fg-3">→</span>
        <KeyChip outlined stageKey={subject.to} />
      </span>
    );
  }
  return <span className="text-fg-3">workflow</span>;
}

function DiffList({ diff }: { diff: VersionDiffView }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line-soft pt-3" aria-label={`Diff ${diff.title}`} data-testid="version-diff">
      <SectionHeader level={3} title={diff.title} action={diff.summary ? <span className="text-small text-fg-3">{diff.summary}</span> : undefined} />
      {diff.loading ? (
        <p className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Loading…
        </p>
      ) : diff.error ? (
        <Callout tone="err">{diff.error}</Callout>
      ) : diff.rows.length === 0 ? (
        <p className="text-small text-fg-3">No differences (canvas positions aside).</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {diff.rows.map((row) => {
            const op = OP[row.op];
            return (
              <li key={row.id} className="flex min-w-0 items-start gap-2 text-small">
                <span className={cn('w-3 shrink-0 font-mono', op.tone)} title={op.label}>
                  <span aria-hidden="true">{op.letter}</span>
                  <span className="sr-only">{op.label}</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-fg-2">
                  <Subject subject={row.subject} />
                  {row.detail ? <span className="text-fg-2">{row.detail}</span> : null}
                  {row.field ? <span className="font-mono text-micro text-fg">{row.field}</span> : null}
                  {row.before !== undefined || row.after !== undefined ? (
                    <span className="min-w-0 font-mono text-micro break-all">
                      <span className="text-fg-3">{row.before ?? '(unset)'}</span>
                      <span className="text-fg-3"> → </span>
                      <span className="text-fg">{row.after ?? '(unset)'}</span>
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The builder's version history (WF-10). */
export function VersionHistoryPanel({
  intro,
  draft,
  versions,
  loading = false,
  error,
  selected,
  onSelectionChange,
  onCompare,
  compared = false,
  onRestore,
  restoringId,
  restoreError,
  diff,
  onClose,
  visibleCount = 5,
  className,
}: VersionHistoryPanelProps) {
  const [showOlder, setShowOlder] = useState(false);
  const list = versions ?? [];
  const shown = showOlder ? list : list.slice(0, visibleCount);
  const older = list.length - shown.length;
  const byId = new Map(list.map((v) => [v.id, v]));
  const nameOf = (id: string) => (id === DRAFT_ID ? 'Draft' : `v${byId.get(id)?.version ?? '?'}`);
  const rank = (id: string) => (id === DRAFT_ID ? Number.POSITIVE_INFINITY : (byId.get(id)?.version ?? 0));
  const pair = selected.length === 2 ? [...selected].sort((a, b) => rank(a) - rank(b)) : null;
  const restorable = selected.filter((id) => id !== DRAFT_ID && byId.has(id)).sort((a, b) => rank(a) - rank(b))[0];
  const restoreRow = restorable ? byId.get(restorable) : undefined;
  const toggle = (id: string, checked: boolean) => {
    const rest = selected.filter((s) => s !== id);
    onSelectionChange(checked ? [...rest.slice(-1), id] : rest);
  };

  return (
    <Inspector
      title={
        <span className="flex items-center gap-2">
          <Icon concept="history" size={14} className="text-fg-3" />
          Version history
        </span>
      }
      label="Version history"
      actions={<IconButton icon="x" size="sm" label="Close version history" onClick={onClose} />}
      className={className}
    >
      {intro != null ? <p className="text-small text-fg-3">{intro}</p> : null}

      {draft ? (
        <div className="flex gap-2.5 rounded-card border border-line-soft bg-raised p-3" data-testid="version-history-draft">
          <Checkbox
            className="mt-0.5"
            checked={selected.includes(DRAFT_ID)}
            onCheckedChange={(checked) => toggle(DRAFT_ID, checked)}
            aria-label="Compare the draft"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-1.5">
              {draft.badges}
              {draft.revision != null ? <span className="ml-auto font-mono text-micro text-fg-3">revision {draft.revision}</span> : null}
            </div>
            {draft.meta != null ? <div className="text-small text-fg-2">{draft.meta}</div> : null}
            {draft.note != null ? <div className="text-small text-fg-3">{draft.note}</div> : null}
          </div>
        </div>
      ) : null}

      <section className="flex flex-col gap-1" aria-label="Versions">
        <SectionHeader
          level={3}
          title="Versions"
          count={list.length || undefined}
          action={list.length > 0 ? <span className="text-small text-fg-3">tick two to compare</span> : undefined}
        />
        {loading ? <SkeletonRows rows={4} label="Loading versions" /> : null}
        {error ? <EmptyState tone="error" icon="warning" title="Could not load the versions" description={error} /> : null}
        {!loading && !error && list.length === 0 ? (
          <p className="text-small text-fg-3">No versions yet: a version is made when the workflow is published or runs as a test run.</p>
        ) : null}
        {shown.length > 0 ? (
          <ol className="flex flex-col">
            {shown.map((v) => {
              const ticked = selected.includes(v.id);
              return (
                <li
                  key={v.id}
                  className={cn('flex h-row items-center gap-2 rounded-control px-2 hover:bg-hover', ticked && 'bg-selected hover:bg-selected')}
                  data-testid="version-row"
                >
                  <Checkbox checked={ticked} onCheckedChange={(checked) => toggle(v.id, checked)} aria-label={`Compare v${v.version}`} />
                  <span className="w-8 shrink-0 font-mono text-ui font-semibold text-fg">v{v.version}</span>
                  {v.live ? <Badge tone="ok">Live</Badge> : null}
                  {v.kind === 'test' ? <Badge>test</Badge> : null}
                  <span className="min-w-0 flex-1 truncate text-small text-fg-2" title={fullDate(v.createdAt)}>
                    {shortDate(v.createdAt)}
                  </span>
                  <span className="shrink-0 font-mono text-micro text-fg-3" title={v.hash}>
                    {v.hash.slice(0, 7)}
                  </span>
                  {restoringId === v.id ? <Spinner size={14} label={`Restoring v${v.version}`} /> : null}
                  <MenuButton
                    label={`v${v.version} actions`}
                    iconOnly
                    icon="more"
                    size="sm"
                    variant="ghost"
                    disabled={!!restoringId}
                    items={[
                      { id: 'restore', label: `Restore v${v.version} as draft`, icon: 'undo', onSelect: () => onRestore(v.id) },
                      {
                        id: 'compare',
                        label: 'Compare with the draft',
                        icon: 'diff',
                        onSelect: () => onSelectionChange([v.id, DRAFT_ID]),
                      },
                    ]}
                  />
                </li>
              );
            })}
          </ol>
        ) : null}
        {older > 0 || (showOlder && list.length > visibleCount) ? (
          <Button
            variant="ghost"
            size="sm"
            icon={showOlder ? 'chevron-up' : 'chevron-down'}
            className="self-start"
            onClick={() => setShowOlder((s) => !s)}
          >
            {showOlder ? 'Show fewer' : `${older} older`}
          </Button>
        ) : null}
      </section>

      {pair || restoreRow ? (
        <div className="flex flex-wrap items-center gap-2">
          {pair ? (
            <Button size="sm" icon="diff" pressed={compared} onClick={onCompare}>
              Diff <span className="font-mono">{nameOf(pair[0]!)}</span> ↔ <span className="font-mono">{nameOf(pair[1]!)}</span>
            </Button>
          ) : null}
          {restoreRow ? (
            <Button
              size="sm"
              icon="undo"
              loading={restoringId === restoreRow.id}
              disabled={!!restoringId}
              onClick={() => onRestore(restoreRow.id)}
              title="Load this version into the editor as unsaved changes"
            >
              Restore <span className="font-mono">v{restoreRow.version}</span> as draft
            </Button>
          ) : null}
        </div>
      ) : null}
      {restoreError ? <Callout tone="err">{restoreError}</Callout> : null}

      {diff ? <DiffList diff={diff} /> : null}
    </Inspector>
  );
}

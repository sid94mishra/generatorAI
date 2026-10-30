// ────────────────────────────────────────────────────────────────
// F-composer-02 ChangesTray — "what has this chat changed so far", docked on
// the composer (03-domain F-composer-02).
//
// The authoritative list comes from the workspace change summary (baseline →
// working tree), the same data the Changes tab renders. While a turn is live,
// file ops arriving on the stream are overlaid immediately so the count moves
// the moment the agent writes a file, before the summary has been refetched.
//
// Collapsed it is one 32px row: disclosure, count ("N files changed · in this
// chat" / "N to review · K kept"), DiffStat, a pulse + "updating…" while a live
// file op is in flight, and ghost Review changes / Keep all / Undo all (Undo
// all confirms first, D-28). Expanded it is a compact tree of the changed
// files grouped by folder (single-child chains collapsed); a click on a file
// opens the Changes tab focused on that file.
// ────────────────────────────────────────────────────────────────

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHANGE_KIND, type ChangeKindValue } from '@generatorai/shared';
import { useInvalidateWorkspaceChangeSummary } from '@/hooks/changesQueries.js';
import { useDiscardWorkspaceChanges, useReviewWorkspaceChanges, useWorkspaceChangeSummary } from '@/hooks/queries.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { splitWorkspaceChanges } from '@/blocks/changes/changeVisibility.js';
import { CHANGE_TONE_CLASS } from '@/blocks/changes/ChangeFileRow.js';
import {
  isInMount,
  shouldPrefixAlias,
  statusFromOpKind,
  toDisplayPath,
  usePathRoots,
  withAliasPrefix,
  type ChangeStatusLetter,
} from '@/blocks/changes/changePaths.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { StatusDot } from '@/ui/primitives/StatusDot/StatusDot.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';
import { cn } from '@/ui/lib/cn.js';
import { Reveal } from '@/ui/primitives/Collapsible/Collapsible.js';

export interface ChangesTrayProps {
  workspaceId?: string | undefined;
  /** Stream key — the chat's session id. */
  sessionId?: string | undefined;
  /** True while a turn is in flight (drives the live pulse + refetch on settle). */
  streaming: boolean;
  /** Opens the Changes tab, optionally focused on one display path. */
  onOpenChanges: (displayPath?: string) => void;
  className?: string;
}

interface ChangedFile {
  path: string;
  status: ChangeStatusLetter;
  additions: number;
  deletions: number;
  /** Not yet confirmed by the workspace summary — came from the live stream. */
  live: boolean;
}

/** Status letter → the shared CHANGE_KIND entry (letter, tone, label). */
const LETTER_KIND: Record<ChangeStatusLetter, ChangeKindValue> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
};

const OPEN_KEY = 'generatorai:chat:changesTray:open';
const LIST_ID = 'chat-changes-tray-list';

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

// ── Tree model ───────────────────────────────────────────────────

interface TreeDir {
  name: string;
  dirs: Map<string, TreeDir>;
  files: ChangedFile[];
}

function buildTree(files: ChangedFile[]): TreeDir {
  const root: TreeDir = { name: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const seg = parts[i]!;
      let next = node.dirs.get(seg);
      if (!next) {
        next = { name: seg, dirs: new Map(), files: [] };
        node.dirs.set(seg, next);
      }
      node = next;
    }
    node.files.push(f);
  }
  return root;
}

interface TreeRow {
  key: string;
  depth: number;
  kind: 'dir' | 'file';
  label: string;
  file?: ChangedFile;
}

/** Flatten the tree, collapsing single-child directory chains (`src/lib`). */
function flattenTree(dir: TreeDir, depth: number, prefix: string, out: TreeRow[]): void {
  const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const d of dirs) {
    let label = d.name;
    let node = d;
    while (node.files.length === 0 && node.dirs.size === 1) {
      const only = [...node.dirs.values()][0]!;
      label = `${label}/${only.name}`;
      node = only;
    }
    const key = `${prefix}${label}/`;
    out.push({ key, depth, kind: 'dir', label });
    flattenTree(node, depth + 1, key, out);
  }
  const files = [...dir.files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of files) {
    out.push({ key: f.path, depth, kind: 'file', label: f.path.split('/').pop() ?? f.path, file: f });
  }
}

/** Row indent: computed geometry, so an inline style. */
const indent = (depth: number) => ({ paddingLeft: 6 + depth * 14 });

// ── Component ────────────────────────────────────────────────────

export const ChangesTray = memo(function ChangesTray({
  workspaceId,
  sessionId,
  streaming,
  onOpenChanges,
  className,
}: ChangesTrayProps) {
  const roots = usePathRoots();
  const invalidateSummary = useInvalidateWorkspaceChangeSummary(workspaceId);
  const summaryQuery = useWorkspaceChangeSummary(workspaceId, { base: 'baseline', head: 'working' });
  // Same two endpoints the Changes tab uses — the tray is a shortcut to them,
  // not a second implementation.
  const reviewChanges = useReviewWorkspaceChanges(workspaceId);
  const discardChanges = useDiscardWorkspaceChanges(workspaceId);
  const confirmer = useConfirm();
  // Root-workspace scaffolding is hidden while a codebase is linked (same
  // rule as the Changes tab), so the count here is the count of code changes.
  const summary = useMemo(() => splitWorkspaceChanges(summaryQuery.data, false).visible, [summaryQuery.data]);
  const codebaseAliases = useMemo(
    () => new Set((summaryQuery.data?.repos ?? []).filter((r) => r.kind !== 'root').map((r) => r.alias)),
    [summaryQuery.data],
  );
  /**
   * Whether a row carries its mount alias.
   *
   * MUST match what the Changes tab does, because a click here hands the tab
   * a display path to focus on — the two namings disagreeing means the click
   * silently lands nowhere.
   */
  const multiMount = shouldPrefixAlias(roots.length);

  // Live file ops, read through a string signature so a streamed token —
  // which replaces the blocks array — does not re-render this tray.
  const liveKey = useStreamStore((state) => {
    const blocks = sessionId ? state.streams[sessionId]?.blocks : undefined;
    if (!blocks) return '';
    let key = '';
    for (const b of blocks) {
      if (b.type === 'tool_call' && b.fileOp) {
        key += `|${b.callId}:${b.fileOp.kind}:${b.fileOp.filePath}:${b.fileOp.additions}:${b.fileOp.deletions}`;
      }
    }
    return key;
  });

  const liveFiles = useMemo(() => {
    void liveKey;
    const blocks = sessionId ? (useStreamStore.getState().streams[sessionId]?.blocks ?? []) : [];
    const byPath = new Map<string, ChangedFile>();
    for (const b of blocks) {
      if (b.type !== 'tool_call' || !b.fileOp) continue;
      // The plan file and other workspace scaffolding are not code changes (the Changes tab hides them too).
      if (!isInMount(b.fileOp.filePath, roots)) continue;
      const path = toDisplayPath(b.fileOp.filePath, roots);
      const prev = byPath.get(path);
      if (prev) {
        prev.additions += b.fileOp.additions;
        prev.deletions += b.fileOp.deletions;
        if (b.fileOp.kind === 'delete') prev.status = 'D';
      } else {
        byPath.set(path, {
          path,
          status: statusFromOpKind(b.fileOp.kind),
          additions: b.fileOp.additions,
          deletions: b.fileOp.deletions,
          live: true,
        });
      }
    }
    return byPath;
  }, [liveKey, sessionId, roots]);

  // The summary lags the disk by one fetch: refetch shortly after each live
  // file op and again when the turn settles, so the tray and the Changes tab
  // converge on the same numbers without the user pressing refresh.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!workspaceId || !liveKey) return;
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      invalidateSummary();
    }, 1500);
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, [liveKey, workspaceId, invalidateSummary]);
  const wasStreaming = useRef(streaming);
  const settledAt = useRef<number>(0);
  useEffect(() => {
    if (wasStreaming.current && !streaming && workspaceId) {
      settledAt.current = Date.now();
      invalidateSummary();
    }
    wasStreaming.current = streaming;
  }, [streaming, workspaceId, invalidateSummary]);

  // The live blocks are cleared the moment the persisted turn lands, which is
  // before the post-turn summary refetch resolves. Carry the live entries
  // across that gap so the tray does not blink empty between the two.
  const carried = useRef<Map<string, ChangedFile>>(new Map());
  if (liveFiles.size > 0) carried.current = liveFiles;
  if (summaryQuery.dataUpdatedAt > settledAt.current && !streaming && liveFiles.size === 0) {
    carried.current = new Map();
  }

  const files = useMemo<ChangedFile[]>(() => {
    const byPath = new Map<string, ChangedFile>();
    for (const repo of summary?.repos ?? []) {
      for (const f of repo.files) {
        const display = withAliasPrefix(repo.alias, f.path, multiMount);
        const status: ChangeStatusLetter =
          f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : f.status === 'renamed' ? 'R' : 'M';
        byPath.set(display, {
          path: display,
          status,
          additions: f.additions,
          deletions: f.deletions,
          live: false,
        });
      }
    }
    const overlay = liveFiles.size > 0 ? liveFiles : carried.current;
    for (const [path, f] of overlay) {
      // A live op outside every mount is workspace scaffolding — keep it out
      // for the same reason the summary's root repo is hidden. Only checkable
      // while paths ARE alias-prefixed; with a single mount `toDisplayPath`
      // has already resolved the file against that mount's root.
      if (multiMount && codebaseAliases.size > 0 && !codebaseAliases.has(path.split('/')[0] ?? '')) {
        continue;
      }
      if (!byPath.has(path)) byPath.set(path, f);
    }
    return [...byPath.values()];
    // `carried` is a ref refreshed in render; `summaryQuery.dataUpdatedAt`
    // stands in for it so the memo recomputes when the carry-over is dropped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, liveFiles, codebaseAliases, multiMount, summaryQuery.dataUpdatedAt, streaming]);

  const rows = useMemo(() => {
    const out: TreeRow[] = [];
    flattenTree(buildTree(files), 0, '', out);
    return out;
  }, [files]);

  /**
   * How many of the summary's files the user has already accepted. Live
   * overlay files are never kept (they were written moments ago), so this
   * counts the summary only.
   */
  const keptCount = useMemo(
    () => (summary?.repos ?? []).reduce((n, r) => n + r.files.filter((f) => f.kept).length, 0),
    [summary],
  );

  const busy = reviewChanges.isPending || discardChanges.isPending;
  const onKeepAll = useCallback(() => {
    void reviewChanges.mutateAsync({ keepAll: true }).catch(() => undefined);
  }, [reviewChanges]);
  const { confirm: askConfirm } = confirmer;
  const onUndoAll = useCallback(() => {
    void (async () => {
      const ok = await askConfirm({
        title: 'Undo all changes?',
        description:
          'This restores every changed file in this chat to its base revision. ' +
          'A checkpoint is written first, so it can still be rewound.',
        confirmLabel: 'Undo all',
        tone: 'danger',
      });
      if (!ok) return;
      await discardChanges.mutateAsync({ all: true }).catch(() => undefined);
    })();
  }, [askConfirm, discardChanges]);

  const [open, setOpen] = useState<boolean>(() => readOpen());
  const toggle = useCallback(() => {
    setOpen((v) => {
      try {
        window.localStorage.setItem(OPEN_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  }, []);

  const hasFiles = files.length > 0;
  const totalAdd = files.reduce((n, f) => n + f.additions, 0);
  const totalDel = files.reduce((n, f) => n + f.deletions, 0);
  const pending = files.some((f) => f.live);
  const pulsing = streaming && pending;

  // The tray eases in above the composer when the first file changes, and its file
  // list eases open and closed (D-109). It leaves at once when nothing is left to show.
  return (
    <Reveal open={hasFiles}>
      {hasFiles ? (
        <div className="pb-2">
          <div
            data-testid="chat-changes-tray"
            className={cn('@container/tray overflow-hidden rounded-card border border-line-soft bg-raised', className)}
          >
            <div className="flex h-control-lg items-center gap-1.5 px-1.5">
              <IconButton
                size="sm"
                icon={open ? 'chevron-down' : 'chevron-right'}
                label={open ? 'Hide changed files' : 'Show changed files'}
                aria-expanded={open}
                aria-controls={LIST_ID}
                onClick={toggle}
              />
              <span className="relative inline-flex shrink-0 items-center justify-center">
                <Icon concept="changes" size={14} className="text-accent" />
                {pulsing ? (
                  <StatusDot tone="run" size="sm" className="absolute -top-0.5 -right-0.5 animate-pulse" />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="min-w-0 truncate text-small font-medium text-fg">
                  {keptCount > 0 ? (
                    <>
                      {files.length - keptCount} to review
                      <span className="font-normal text-fg-3"> · {keptCount} kept</span>
                    </>
                  ) : (
                    <>
                      {files.length} {files.length === 1 ? 'file' : 'files'} changed
                      <span className="font-normal text-fg-3"> · in this chat</span>
                    </>
                  )}
                </span>
                <DiffStat added={totalAdd} removed={totalDel} className="shrink-0" />
                {pulsing ? (
                  <span className="hidden shrink-0 animate-pulse text-micro text-fg-3 sm:inline">updating…</span>
                ) : null}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="changes"
                onClick={() => onOpenChanges()}
                title="Open the Changes tab"
                data-testid="chat-changes-tray-review"
                aria-label="Review changes"
              >
                {/* A narrow chat column keeps the summary readable: the buttons drop to icons. */}
                <span className="hidden @xl/tray:inline">Review changes</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="check"
                onClick={onKeepAll}
                disabled={busy || files.length === keptCount}
                title="Mark every changed file as reviewed"
                data-testid="chat-changes-tray-keep-all"
                aria-label="Keep all"
              >
                {/* A narrow chat column keeps the summary readable: the buttons drop to icons. */}
                <span className="hidden @xl/tray:inline">Keep all</span>
              </Button>
              <Button
                type="button"
                variant="danger-ghost"
                size="sm"
                icon="undo"
                onClick={onUndoAll}
                disabled={busy}
                title="Restore every changed file to its base revision"
                data-testid="chat-changes-tray-undo-all"
                aria-label="Undo all"
              >
                {/* A narrow chat column keeps the summary readable: the buttons drop to icons. */}
                <span className="hidden @xl/tray:inline">Undo all</span>
              </Button>
            </div>
            {confirmer.dialog}

            <Reveal id={LIST_ID} open={open}>
              <div className="max-h-56 overflow-y-auto border-t border-line-soft px-1.5 py-1">
                {rows.map((row) => {
                  if (row.kind === 'dir') {
                    return (
                      <div
                        key={row.key}
                        className="flex h-control-sm items-center gap-1.5 text-micro text-fg-3"
                        style={indent(row.depth)}
                      >
                        <Icon concept="folder-open" size={14} />
                        <span className="truncate">{row.label}</span>
                      </div>
                    );
                  }
                  const file = row.file!;
                  const kind = CHANGE_KIND[LETTER_KIND[file.status]];
                  return (
                    <Button
                      key={row.key}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpenChanges(file.path)}
                      title={`${kind.label} · ${file.path} — open in Changes`}
                      // The Button wraps its children in one span: lay that span out as the row.
                      className="w-full min-w-0 justify-start pr-1.5 font-normal *:flex *:flex-1 *:items-center *:gap-1.5"
                      style={indent(row.depth)}
                      data-testid="chat-changes-tray-file"
                    >
                      <Icon concept="file" size={14} className="shrink-0 text-fg-3" />
                      <span className="min-w-0 flex-1 truncate text-left font-mono text-micro text-fg">
                        {row.label}
                      </span>
                      <span
                        className={cn(
                          'w-3 shrink-0 text-center font-mono text-small font-semibold',
                          CHANGE_TONE_CLASS[kind.tone],
                        )}
                        aria-label={kind.label}
                      >
                        {kind.letter}
                      </span>
                      <DiffStat added={file.additions} removed={file.deletions} className="w-16 shrink-0 justify-end" />
                    </Button>
                  );
                })}
              </div>
            </Reveal>
          </div>
        </div>
      ) : null}
    </Reveal>
  );
});

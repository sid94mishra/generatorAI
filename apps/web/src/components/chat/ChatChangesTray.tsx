// ────────────────────────────────────────────────────────────────
// ChatChangesTray — "what has this chat changed so far", docked on the composer.
//
// The authoritative list comes from the workspace change summary (baseline →
// working tree), the same data the Changes tab renders. While a turn is live,
// file ops arriving on the stream are overlaid immediately so the count moves
// the moment the agent writes a file, before the summary has been refetched.
//
// Collapsed it is one line: count, +/− totals, a live pulse while files are
// still changing, and the "Review changes" button that opens the Changes tab.
// Expanded it is a compact tree of the changed files; a click on a file opens
// the Changes tab focused on that file.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ChevronRight, FileDiff, Undo2 } from 'lucide-react';
import {
  useDiscardWorkspaceChanges,
  useReviewWorkspaceChanges,
  useWorkspaceChangeSummary,
} from '@/hooks/queries.js';
import { useConfirm } from '@/components/ui/index.js';
import { useStreamStore } from '@/stores/streamStore.js';
import { Button } from '@/components/ui/index.js';
import { FileTypeIcon, FolderTypeIcon } from '@/components/shared/fileIcons.js';
import { splitWorkspaceChanges } from '@/components/diff/changeVisibility.js';
import { cn } from '@/lib/utils.js';
import {
  shouldPrefixAlias,
  statusFromOpKind,
  toDisplayPath,
  usePathRoots,
  withAliasPrefix,
  type ChangeStatusLetter,
} from './changes/changePaths.js';

export interface ChatChangesTrayProps {
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

const STATUS_CLASS: Record<ChangeStatusLetter, string> = {
  A: 'bg-success-muted text-success',
  M: 'bg-warning-muted text-warning',
  D: 'bg-danger-muted text-danger',
  R: 'bg-info-muted text-info',
};

const STATUS_TITLE: Record<ChangeStatusLetter, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
};

const OPEN_KEY = 'generatorai:chat:changesTray:open';

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

// ── Component ────────────────────────────────────────────────────

export const ChatChangesTray = React.memo(function ChatChangesTray({
  workspaceId,
  sessionId,
  streaming,
  onOpenChanges,
  className,
}: ChatChangesTrayProps) {
  const roots = usePathRoots();
  const queryClient = useQueryClient();
  const summaryQuery = useWorkspaceChangeSummary(workspaceId, { base: 'baseline', head: 'working' });
  // Same two endpoints the Changes tab uses — the tray is a shortcut to them,
  // not a second implementation.
  const reviewChanges = useReviewWorkspaceChanges(workspaceId);
  const discardChanges = useDiscardWorkspaceChanges(workspaceId);
  const { confirm: confirmAction, dialog: confirmDialog } = useConfirm();
  // Root-workspace scaffolding is hidden while a codebase is linked (same
  // rule as the Changes tab), so the count here is the count of code changes.
  const summary = useMemo(
    () => splitWorkspaceChanges(summaryQuery.data, false).visible,
    [summaryQuery.data],
  );
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
      void queryClient.invalidateQueries({ queryKey: ['workspace-change-summary', workspaceId] });
    }, 1500);
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, [liveKey, workspaceId, queryClient]);
  const wasStreaming = useRef(streaming);
  const settledAt = useRef<number>(0);
  useEffect(() => {
    if (wasStreaming.current && !streaming && workspaceId) {
      settledAt.current = Date.now();
      void queryClient.invalidateQueries({ queryKey: ['workspace-change-summary', workspaceId] });
    }
    wasStreaming.current = streaming;
  }, [streaming, workspaceId, queryClient]);

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
  const onUndoAll = useCallback(() => {
    void (async () => {
      const ok = await confirmAction({
        title: 'Undo all changes?',
        description:
          'This restores every changed file in this chat to its base revision. ' +
          'A checkpoint is written first, so it can still be rewound.',
        confirmLabel: 'Undo all',
        variant: 'destructive',
      });
      if (!ok) return;
      await discardChanges.mutateAsync({ all: true }).catch(() => undefined);
    })();
  }, [confirmAction, discardChanges]);

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

  if (files.length === 0) return null;

  const totalAdd = files.reduce((n, f) => n + f.additions, 0);
  const totalDel = files.reduce((n, f) => n + f.deletions, 0);
  const pending = files.some((f) => f.live);
  const pulsing = streaming && pending;

  return (
    <div
      data-testid="chat-changes-tray"
      className={cn(
        'mb-2 overflow-hidden rounded-xl border border-border/70 bg-card/80 shadow-sm backdrop-blur-sm',
        className,
      )}
    >
      <div className="flex items-center gap-1.5 pl-1.5 pr-1.5">
        <Button
          type="button"
          variant="ghost"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="chat-changes-tray-list"
          className="h-8 min-w-0 flex-1 justify-start gap-2 rounded-lg px-1.5 text-left font-normal hover:bg-subtle/70"
          title={open ? 'Hide changed files' : 'Show changed files'}
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          />
          <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            <FileDiff className="h-3.5 w-3.5 text-primary" />
            {pulsing && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary animate-status-breathe"
              />
            )}
          </span>
          <span className="truncate text-[12px] font-medium text-foreground">
            {keptCount > 0 ? (
              <>
                {files.length - keptCount} to review
                <span className="font-normal text-muted-foreground"> · {keptCount} kept</span>
              </>
            ) : (
              <>
                {files.length} {files.length === 1 ? 'file' : 'files'} changed
                <span className="font-normal text-muted-foreground"> in this chat</span>
              </>
            )}
          </span>
          <span className="ml-1 shrink-0 font-mono text-[10.5px] tabular-nums">
            <span className="text-success">+{totalAdd}</span>{' '}
            <span className="text-danger">−{totalDel}</span>
          </span>
          {pulsing && (
            <span className="ml-1 hidden shrink-0 text-[10.5px] text-muted-foreground sm:inline">updating…</span>
          )}
        </Button>
        <Button
          type="button"
          variant="subtle"
          size="sm"
          onClick={() => onOpenChanges()}
          className="h-7 shrink-0 gap-1.5 rounded-lg px-2.5 text-[11.5px]"
          title="Open the Changes tab"
          data-testid="chat-changes-tray-review"
        >
          <FileDiff className="h-3.5 w-3.5" />
          Review changes
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onKeepAll}
          disabled={busy || files.length === keptCount}
          className="h-7 shrink-0 gap-1 rounded-lg px-1.5 text-[11.5px] font-normal"
          title="Mark every changed file as reviewed"
          data-testid="chat-changes-tray-keep-all"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Keep all
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onUndoAll}
          disabled={busy}
          className="h-7 shrink-0 gap-1 rounded-lg px-1.5 text-[11.5px] font-normal text-danger hover:bg-danger-muted"
          title="Restore every changed file to its base revision"
          data-testid="chat-changes-tray-undo-all"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Undo all
        </Button>
      </div>
      {confirmDialog}

      {open && (
        <div
          id="chat-changes-tray-list"
          className="max-h-56 overflow-y-auto border-t border-border/60 px-1.5 py-1"
        >
          {rows.map((row) =>
            row.kind === 'dir' ? (
              <div
                key={row.key}
                className="flex h-6 items-center gap-1.5 text-[11px] text-muted-foreground"
                style={{ paddingLeft: 6 + row.depth * 14 }}
              >
                <FolderTypeIcon open className="h-3.5 w-3.5" />
                <span className="truncate">{row.label}</span>
              </div>
            ) : (
              <Button
                key={row.key}
                type="button"
                variant="ghost"
                onClick={() => onOpenChanges(row.file!.path)}
                title={`${STATUS_TITLE[row.file!.status]} · ${row.file!.path} — open in Changes`}
                className="h-6 w-full min-w-0 items-center justify-start gap-1.5 rounded-md py-0 pr-1.5 text-left font-normal hover:bg-subtle/70"
                style={{ paddingLeft: 6 + row.depth * 14 }}
                data-testid="chat-changes-tray-file"
              >
                <FileTypeIcon name={row.label} className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90">{row.label}</span>
                <span
                  className={cn(
                    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9.5px] font-semibold',
                    STATUS_CLASS[row.file!.status],
                  )}
                  aria-label={STATUS_TITLE[row.file!.status]}
                >
                  {row.file!.status}
                </span>
                <span className="w-16 shrink-0 text-right font-mono text-[10.5px] tabular-nums">
                  <span className="text-success">+{row.file!.additions}</span>{' '}
                  <span className="text-danger">−{row.file!.deletions}</span>
                </span>
              </Button>
            ),
          )}
        </div>
      )}
    </div>
  );
});

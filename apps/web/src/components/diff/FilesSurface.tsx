// ────────────────────────────────────────────────────────────────
// FilesSurface — browse and read every file in the workspace
// ────────────────────────────────────────────────────────────────
//
// Deliberately NOT a diff view. The Changes tab already answers "what did
// the agent change?" against git; this answers "what is in here?", so a file
// nobody touched still opens with syntax highlighting and line numbers.
//
// Keeping the two apart is what makes each one fast: the path list only
// moves when files are created or deleted (`workspace-tree`), while the diff
// summary moves on every write. Neither refetches the other's data.
//
// The same component serves two hosts:
//
//   • the Files tab — tree on the left, preview on the right
//   • a per-file tab — the tree starts collapsed and the breadcrumb doubles
//     as its toggle, so the file gets the full pane width
//
// One component rather than two because the preview, the markdown toggle and
// the loading / binary / too-large states are identical in both.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Code2,
  Eye,
  ListTree,
  Loader2,
  RefreshCw,
  WrapText,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { ApiError } from '@/platform/apiFetch.js';
import { useWorkspaceTree, useWorkspaceTreeFile } from '@/hooks/queries.js';
import { FileTypeIcon } from '@/components/shared/fileIcons.js';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer.js';
import { FileCodeView } from './FileCodeView.js';
import { DiffProviders } from './DiffProviders.js';
import { ChangesTree } from './ChangesTree.js';
import type { FileTabRef } from './fileTabId.js';

export interface FilesSurfaceProps {
  workspaceId?: string;
  /** Renders without outer chrome (inside the RightPane host). */
  embedded?: boolean;
  /**
   * Opens directly on this file. Set by a per-file tab; the tree then starts
   * collapsed so the file gets the whole pane.
   */
  initialFile?: FileTabRef;
  /** Double-click / ⏎ on a tree row. Omit to disable opening files in tabs. */
  onOpenFile?: (ref: FileTabRef) => void;
  /**
   * Fires whenever the previewed file changes, so the host can title the tab
   * after it. Scoped per surface instance, which is what keeps two Files
   * tabs from overwriting each other's label.
   */
  onSelectionChange?: (ref: FileTabRef | null) => void;
}

/** Extensions that get a rendered-vs-source toggle. */
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown']);

function isMarkdownPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MARKDOWN_EXTENSIONS.has(ext);
}

export function FilesSurface({
  workspaceId,
  embedded = false,
  initialFile,
  onOpenFile,
  onSelectionChange,
}: FilesSurfaceProps) {
  const [showTree, setShowTree] = useState(!initialFile);
  const [wrapLines, setWrapLines] = useState(false);
  const [repoAlias, setRepoAlias] = useState<string>(initialFile?.alias ?? '*');
  const [selection, setSelection] = useState<FileTabRef | null>(initialFile ?? null);
  /** Markdown only: rendered preview vs. highlighted source. */
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'code'>('preview');

  const treeQuery = useWorkspaceTree(workspaceId);
  const repos = useMemo(() => treeQuery.data?.repos ?? [], [treeQuery.data]);
  const multiRepo = repos.length > 1;

  /** Whether tree paths carry an `alias/` prefix — only when repos are mixed. */
  const prefixed = multiRepo && repoAlias === '*';

  /** Displayed path → its repo alias + repo-relative path. */
  const pathIndex = useMemo(() => {
    const map = new Map<string, FileTabRef>();
    for (const repo of repos) {
      if (repoAlias !== '*' && repo.alias !== repoAlias) continue;
      const prefix = prefixed && repo.alias !== '.' ? `${repo.alias}/` : '';
      for (const p of repo.paths) map.set(prefix + p, { alias: repo.alias, path: p });
    }
    return map;
  }, [repos, repoAlias, prefixed]);

  const treePaths = useMemo(() => [...pathIndex.keys()].sort(), [pathIndex]);

  /** The selection's path as the tree displays it, for reveal + highlight. */
  const activeTreePath = useMemo(() => {
    if (!selection) return null;
    return prefixed && selection.alias !== '.'
      ? `${selection.alias}/${selection.path}`
      : selection.path;
  }, [selection, prefixed]);

  const handleSelect = useCallback(
    (displayPath: string) => {
      // Folder rows arrive with a trailing slash; only files open a preview.
      if (displayPath.endsWith('/')) return;
      const resolved = pathIndex.get(displayPath);
      if (!resolved) return;
      // Single click previews in place. Opening a whole tab per click made
      // browsing hostile — skimming five files left five tabs behind, and the
      // new tab stole focus from the tree you were reading.
      setSelection(resolved);
    },
    [pathIndex],
  );

  /** Double-click / ⏎ — the deliberate "keep this open" gesture. */
  const handleActivate = useCallback(
    (displayPath: string) => {
      if (displayPath.endsWith('/')) return;
      const resolved = pathIndex.get(displayPath);
      if (!resolved) return;
      setSelection(resolved);
      onOpenFile?.(resolved);
    },
    [pathIndex, onOpenFile],
  );

  // Follow the host's file when a tab is re-pointed (or restored on reload).
  const initialAlias = initialFile?.alias;
  const initialPath = initialFile?.path;
  useEffect(() => {
    if (initialAlias && initialPath) setSelection({ alias: initialAlias, path: initialPath });
  }, [initialAlias, initialPath]);

  // Publish the selection so the host can label this tab after it. Kept in an
  // effect rather than inlined into every setter so restore-on-mount and
  // clear-on-delete report too, not just user clicks.
  const notifySelection = useRef(onSelectionChange);
  useEffect(() => {
    notifySelection.current = onSelectionChange;
  }, [onSelectionChange]);
  useEffect(() => {
    notifySelection.current?.(selection);
  }, [selection]);

  // Drop a selection that no longer exists (repo switched, file deleted).
  // A file tab keeps its selection so the preview can explain what happened
  // instead of the tab silently emptying itself.
  useEffect(() => {
    if (initialFile || !selection || treeQuery.isLoading) return;
    if (!activeTreePath || treePaths.includes(activeTreePath)) return;
    setSelection(null);
  }, [treePaths, activeTreePath, selection, initialFile, treeQuery.isLoading]);

  const file = useWorkspaceTreeFile(
    workspaceId,
    selection?.path,
    { alias: selection?.alias ?? '.' },
    !!selection,
  );

  const isMarkdown = !!selection && isMarkdownPath(selection.path);
  const fileName = selection ? (selection.path.split('/').pop() ?? selection.path) : '';

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        No workspace yet — files appear once the agent starts working.
      </div>
    );
  }

  const truncated = repos.some((r) => r.truncated);

  return (
    // Matches the canvas `FileCodeView` paints (see `diffHostStyle`), so the
    // tree and the toolbar sit on the same colour as the code beside them
    // rather than on the host pane's translucent card tint.
    <div
      className={cn(
        'flex h-full min-h-0 flex-col bg-background',
        !embedded && 'rounded-lg border',
      )}
    >
      {/* ── Breadcrumb / action bar ────────────────────────────── */}
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        <button
          type="button"
          onClick={() => setShowTree((v) => !v)}
          aria-label={showTree ? 'Hide file tree' : 'Show file tree'}
          aria-pressed={showTree}
          title={showTree ? 'Hide file tree' : 'Show file tree'}
          className={cn(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-accent',
            showTree && 'bg-accent',
          )}
        >
          <ListTree className="h-3.5 w-3.5" />
        </button>

        {selection ? (
          <>
            <FileTypeIcon name={fileName} className="h-3.5 w-3.5 shrink-0" />
            <span
              className="min-w-0 flex-1 truncate text-xs font-medium"
              title={
                selection.alias === '.'
                  ? selection.path
                  : `${selection.alias}/${selection.path}`
              }
            >
              {fileName}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            Files
          </span>
        )}

        <div className={cn('flex shrink-0 items-center gap-0.5', !selection && 'ml-auto')}>          {multiRepo && (
            <select
              value={repoAlias}
              onChange={(e) => {
                setRepoAlias(e.target.value);
                setSelection(null);
              }}
              className="mr-1 h-6 max-w-[130px] rounded border bg-transparent px-1 text-[11px]"
              title="Repository"
              aria-label="Repository"
            >
              <option value="*">All repos ({repos.length})</option>
              {repos.map((r) => (
                <option key={r.alias} value={r.alias}>
                  {r.alias === '.' ? 'workspace root' : r.alias}
                </option>
              ))}
            </select>
          )}

          {isMarkdown && (
            <div className="mr-1 flex items-center rounded border p-px">
              <ModeButton
                active={markdownMode === 'preview'}
                onClick={() => setMarkdownMode('preview')}
                label="Rendered preview"
              >
                <Eye className="h-3 w-3" />
              </ModeButton>
              <ModeButton
                active={markdownMode === 'code'}
                onClick={() => setMarkdownMode('code')}
                label="Source code"
              >
                <Code2 className="h-3 w-3" />
              </ModeButton>
            </div>
          )}

          {/* Wrapping only applies to the code renderer; markdown already
              wraps, so the control would be a no-op in preview mode. */}
          {(!isMarkdown || markdownMode === 'code') && (
            <IconButton
              title={wrapLines ? 'Disable line wrap' : 'Wrap long lines'}
              onClick={() => setWrapLines((w) => !w)}
              active={wrapLines}
            >
              <WrapText className="h-3.5 w-3.5" />
            </IconButton>
          )}
          <IconButton
            title="Refresh"
            onClick={() => {
              void treeQuery.refetch();
              void file.refetch();
            }}
            disabled={treeQuery.isRefetching}
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', treeQuery.isRefetching && 'animate-spin')}
            />
          </IconButton>
        </div>
      </div>

      {truncated && (
        <div className="border-b bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600 dark:text-amber-400">
          This repository has more files than can be listed; the tree is truncated.
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {showTree && (
          <div className="w-60 shrink-0 border-r">
            {treeQuery.isLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading files…
              </div>
            ) : treePaths.length === 0 ? (
              <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
                No files in this workspace yet.
              </div>
            ) : (
              <ChangesTree
                paths={treePaths}
                activePath={activeTreePath}
                onSelect={handleSelect}
                {...(onOpenFile ? { onActivate: handleActivate } : {})}
                searchPlaceholder="Filter files…"
                style={{ height: '100%' }}
              />
            )}
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {selection ? (
            <FilePreview
              path={selection.path}
              isMarkdown={isMarkdown}
              markdownMode={markdownMode}
              wrapLines={wrapLines}
              loading={file.isLoading}
              error={file.error}
              {...(file.data ? { file: file.data } : {})}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-xs text-muted-foreground">
              <span>Select a file to preview it.</span>
              {onOpenFile && (
                <span className="text-[10px]">Double-click to open it in its own tab.</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function FilePreview({
  path,
  isMarkdown,
  markdownMode,
  file,
  wrapLines,
  loading,
  error,
}: {
  path: string;
  isMarkdown: boolean;
  markdownMode: 'preview' | 'code';
  file?: {
    contents: string | null;
    isBinary: boolean;
    isTooLarge: boolean;
    size: number;
    cacheKey: string;
  };
  wrapLines: boolean;
  loading: boolean;
  error: unknown;
}) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        {describeFileError(error)}
      </div>
    );
  }
  if (!file) return null;

  if (file.isBinary) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Binary file ({formatBytes(file.size)}) — nothing to display.
      </div>
    );
  }
  if (file.isTooLarge || file.contents === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        File is too large to preview ({formatBytes(file.size)}).
      </div>
    );
  }

  if (isMarkdown && markdownMode === 'preview') {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <MarkdownRenderer content={file.contents} className="max-w-none" />
      </div>
    );
  }

  return (
    // W28 — see the identical comment in ChangesSurface.tsx: DiffProviders
    // wraps at the point of use, not the app root, safely (true singleton
    // pool underneath) and keeps the highlighter/WASM bundle out of every
    // page load that never opens a file.
    <DiffProviders>
      <FileCodeView
        name={path}
        contents={file.contents}
        cacheKey={file.cacheKey}
        wrapLines={wrapLines}
        hideHeader
        style={{ height: '100%', overflow: 'auto' }}
      />
    </DiffProviders>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'inline-flex h-[18px] items-center rounded-sm px-1.5',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50',
      )}
    >
      {children}
    </button>
  );
}

function IconButton({
  children,
  title,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-50',
        active && 'bg-accent',
      )}
    >
      {children}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Turn a fetch failure into something worth reading.
 *
 * A 404 here is an ordinary race, not a fault: the tree is a snapshot, and
 * the agent can delete a file between the listing and the click. Raw
 * `ApiError: File not found` reads like a bug and gives the user nothing to
 * act on.
 */
function describeFileError(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) {
    return 'This file no longer exists in the workspace.';
  }
  return error instanceof Error ? error.message : 'Could not load this file.';
}
